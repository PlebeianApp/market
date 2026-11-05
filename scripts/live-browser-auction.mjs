#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { liveBrowserRequestPacingPrelude } from "./live-browser-request-pacing.mjs";

const CHROME = "/home/maximoto/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome";
const CREDENTIALS = process.env.PLEBEIAN_DEMO_CREDENTIALS || "";
const SITE = "https://139.162.161.233/";
const FUNDING = 10_000;
const BIDS = [100, 200, 300, 400];
const RATE_SETTLE_MS = 10_000;
// The five real users arrive from separate networks. This one-host acceptance
// runner does not, so pace each tab's explicit same-origin reads below the
// public per-IP limit instead of weakening that production protection.
const SAME_ORIGIN_REQUEST_SPACING_MS = 350;
const PROXY_SERVER = process.env.PLEBEIAN_BROWSER_PROXY || "";
if (PROXY_SERVER && !/^socks5:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(PROXY_SERVER)) {
  throw new Error("PLEBEIAN_BROWSER_PROXY must be a loopback SOCKS5 endpoint");
}
if (!CREDENTIALS.startsWith("/") || CREDENTIALS.includes("\0")) {
  throw new Error("PLEBEIAN_DEMO_CREDENTIALS must name the owner-only absolute credential file");
}

function credentials() {
  const records = new Map();
  for (const line of readFileSync(CREDENTIALS, "utf8").split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error("approved credential record is malformed");
    records.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return [1, 2, 3, 4, 5].map((slot) => {
    const username = `demo-${slot}`, password = records.get(username);
    if (!password || password.length < 20) throw new Error(`approved ${username} credential is unavailable`);
    return { username, password };
  });
}

class PipeCdp {
  constructor(chrome) {
    this.chrome = chrome;
    this.input = chrome.stdio[3];
    this.output = chrome.stdio[4];
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    this.output.on("data", (chunk) => this.onData(chunk));
    this.output.on("error", (error) => this.rejectAll(error));
    chrome.on("exit", (code, signal) => this.rejectAll(new Error(`browser exited (${code ?? signal})`)));
  }
  rejectAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf(0);
      if (end < 0) return;
      const raw = this.buffer.subarray(0, end).toString("utf8");
      this.buffer = this.buffer.subarray(end + 1);
      if (!raw) continue;
      let message;
      try { message = JSON.parse(raw); }
      catch { this.rejectAll(new Error("browser protocol returned malformed JSON")); return; }
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) continue;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
        else request.resolve(message.result ?? {});
        continue;
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.method !== message.method || waiter.sessionId !== message.sessionId) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message.params ?? {});
      }
    }
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
      this.input.write(`${JSON.stringify(message)}\0`, (error) => {
        if (!error) return;
        this.pending.delete(id); reject(error);
      });
    });
  }
  event(method, sessionId, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve, reject };
      this.waiters.push(waiter);
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      waiter.resolve = (value) => { clearTimeout(timer); resolve(value); };
      waiter.reject = (error) => { clearTimeout(timer); reject(error); };
    });
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class DemoPage {
  constructor(cdp, sessionId, role) { this.cdp = cdp; this.sessionId = sessionId; this.role = role; }
  async evaluate(expression) {
    const result = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, this.sessionId);
    if (result.exceptionDetails) throw new Error(`${this.role}: ${result.exceptionDetails.text || "browser evaluation failed"}`);
    return result.result?.value;
  }
  async poll(expression, accept, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs; let value;
    while (Date.now() < deadline) {
      value = await this.evaluate(expression);
      if (accept(value)) return value;
      await delay(500);
    }
    throw new Error(`${this.role}: ${label} timed out (last=${JSON.stringify(value)})`);
  }
  async waitActionEnabled(selector, label) {
    let consecutive = 0;
    await this.poll(`(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      return Boolean(control) && control.disabled === false;
    })()`, (enabled) => {
      consecutive = enabled ? consecutive + 1 : 0;
      return consecutive >= 2;
    }, 60_000, `${label} readiness`);
  }
  status() {
    return this.evaluate(`(() => ({
      actor: document.querySelector('#actor')?.textContent || '',
      message: document.querySelector('#message')?.textContent || '',
      spendable: document.querySelector('#spendable')?.textContent || '',
      locked: document.querySelector('#locked')?.textContent || '',
      refundable: document.querySelector('#refundable')?.textContent || '',
      fundDisabled: document.querySelector('#faucet')?.disabled ?? true,
      createDisabled: document.querySelector('#create-submit')?.disabled ?? true
    }))()`);
  }
  async open(credential) {
    const authorization = `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`;
    await this.cdp.send("Network.setExtraHTTPHeaders", { headers: { Authorization: authorization } }, this.sessionId);
    const loaded = this.cdp.event("Page.loadEventFired", this.sessionId);
    const navigation = await this.cdp.send("Page.navigate", { url: SITE }, this.sessionId);
    if (navigation.errorText) throw new Error(`${this.role}: navigation failed: ${navigation.errorText}`);
    await loaded;
    await this.poll(`(() => ({
      signer: typeof globalThis.plebeianCreateDemoSigner,
      connector: typeof globalThis.plebeianFridayR20Connect,
      handler: typeof document.querySelector('#demo-login')?.onclick,
      disabled: document.querySelector('#demo-login')?.disabled,
      message: document.querySelector('#message')?.textContent || ''
    }))()`, (value) => value?.signer === "function" && value?.connector === "function"
      && value?.handler === "function" && value?.disabled === false
      && value?.message === "Runtime ready. Connect an identity or continue.", 45_000, "runtime readiness");
    await this.evaluate(`document.querySelector('#demo-login').click(); true`);
    const connected = await this.poll(`(() => ({
      actor: document.querySelector('#actor')?.textContent || '',
      message: document.querySelector('#message')?.textContent || '',
      spendable: document.querySelector('#spendable')?.textContent || '',
      fundDisabled: document.querySelector('#faucet')?.disabled ?? true,
      createDisabled: document.querySelector('#create-submit')?.disabled ?? true
    }))()`, (value) => value?.actor.startsWith('tab-local demo signer · ')
      && value?.fundDisabled === false && value?.createDisabled === false,
    60_000, "demo identity connection");
    return connected;
  }
  async balance() {
    const value = await this.status();
    const parse = (text) => text === "—" ? null : Number(String(text).replace(/[^0-9-]/g, ""));
    return { available: parse(value.spendable), locked: parse(value.locked), pending: parse(value.refundable) };
  }
  async fund() {
    let before = await this.balance();
    for (let attempt = 0; attempt < 4 && before.available === null; attempt += 1) {
      await delay(RATE_SETTLE_MS);
      await this.refreshView();
      before = await this.balance();
    }
    if (before.available !== 0 || before.locked !== 0 || before.pending !== 0) {
      throw new Error(`${this.role}: fresh wallet is not empty`);
    }
    // A valid cold readiness sample may briefly disable mutations while the
    // next sample warms the continuity gate. Never drop a synthetic click on
    // a disabled control and then mistake the absence of a request for a
    // funding timeout.
    await this.waitActionEnabled("#faucet", "fake funding");
    await this.evaluate(`(() => {
      const input = document.querySelector('#faucet-amount'); input.value = '${FUNDING}';
      document.querySelector('#faucet').click(); return true;
    })()`);
    const result = await this.poll(`(() => ({
      message: document.querySelector('#message')?.textContent || '',
      spendable: document.querySelector('#spendable')?.textContent || '',
      label: document.querySelector('#faucet')?.textContent || ''
    }))()`, (value) => /finalized in Coco/.test(value?.message || '')
      || (/error|refused|failed|invalid|unavailable/i.test(value?.message || '') && value?.label !== 'Funding…'),
    120_000, "fake funding");
    if (!/finalized in Coco/.test(result.message)) throw new Error(`${this.role}: funding failed: ${result.message}`);
    await this.poll(`document.querySelector('#spendable')?.textContent || ''`,
      (value) => Number(String(value).replace(/[^0-9-]/g, "")) === FUNDING, 45_000, "funded balance");
  }
  async state() {
    return this.evaluate(`fetch('/api/state', { credentials: 'same-origin', headers: { accept: 'application/json' } }).then(async (response) => {
      if (!response.ok) throw new Error('state HTTP ' + response.status); return response.json();
    })`);
  }
  async validators() {
    return this.evaluate(`fetch('/api/validators', { credentials: 'same-origin', headers: { accept: 'application/json' } }).then(async (response) => {
      if (!response.ok) throw new Error('validators HTTP ' + response.status); return response.json();
    })`);
  }
  async createAuction(title) {
    await this.waitActionEnabled("#create-submit", "auction creation");
    await this.evaluate(`(() => {
      document.querySelector('#title').value = ${JSON.stringify(title)};
      document.querySelector('#description').value = 'Five-member live fake-sat browser acceptance';
      document.querySelector('#duration').value = '600';
      document.querySelector('#starting').value = '100';
      document.querySelector('#increment').value = '100';
      document.querySelector('#reserve').value = '0';
      document.querySelector('#create-form').requestSubmit(); return true;
    })()`);
    const result = await this.poll(`(() => ({ message: document.querySelector('#message')?.textContent || '', label: document.querySelector('#create-submit')?.textContent || '' }))()`,
      (value) => /Auction committed at height/.test(value?.message || '')
        || (/error|refused|failed|invalid|unavailable/i.test(value?.message || '') && value?.label !== 'Signing…'),
      90_000, "auction creation");
    if (!/Auction committed at height/.test(result.message)) throw new Error(`${this.role}: auction creation failed: ${result.message}`);
    const view = await this.poll(`fetch('/api/state', { credentials: 'same-origin', headers: { accept: 'application/json' } }).then((response) => response.json())`,
      (value) => Object.values(value?.state?.auctions || {}).some((auction) => auction.title === title),
      45_000, "committed auction visibility");
    return Object.values(view.state.auctions).find((auction) => auction.title === title);
  }
  auctionAction(title, action, amount = 0) {
    return this.evaluate(`(() => {
      const card = [...document.querySelectorAll('article.auction')].find((node) => node.querySelector('h3')?.textContent === ${JSON.stringify(title)});
      if (!card) return { ok: false, reason: 'auction card absent' };
      if (${JSON.stringify(action)} === 'approval') {
        const button = [...card.querySelectorAll('button')].find((node) => /bid-plan approvals/.test(node.textContent || ''));
        if (!button) return { ok: false, reason: 'approval button absent' }; button.click(); return { ok: true, label: button.textContent };
      }
      const input = card.querySelector('.actions input[type=number]');
      const button = [...card.querySelectorAll('button')].find((node) => /Authorize funded bid/.test(node.textContent || ''));
      if (!input || !button) return { ok: false, reason: 'bid controls absent' };
      input.value = String(${amount}); button.click(); return { ok: true };
    })()`);
  }
  async refreshView() {
    await this.evaluate(`document.querySelector('#refresh')?.click(); true`);
    await delay(750);
  }
  async waitAuctionCard(title) {
    await this.refreshView();
    await this.poll(`([...document.querySelectorAll('article.auction')].some((node) => node.querySelector('h3')?.textContent === ${JSON.stringify(title)}))`,
      Boolean, 45_000, "auction card");
  }
  async enableApprovals(title) {
    await this.waitAuctionCard(title);
    await this.waitActionEnabled("#process-payments", "seller approval");
    const action = await this.auctionAction(title, "approval");
    if (!action.ok) throw new Error(`${this.role}: ${action.reason}`);
    await this.poll(`document.querySelector('#seller-approval-status')?.textContent || ''`,
      (value) => /Approvals enabled/.test(value), 15_000, "seller approval opt-in");
  }
  async waitSellerRegistered() {
    return this.poll(`document.querySelector('#seller-approval-status')?.textContent || ''`,
      (value) => /Registered [1-9][0-9]* seller plan/.test(value), 75_000, "seller plan registration");
  }
  async servicePendingPlan() {
    await this.waitActionEnabled("#process-payments", "manual seller service");
    const started = await this.evaluate(`(() => {
      const button = document.querySelector('#process-payments');
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`);
    if (!started) throw new Error(`${this.role}: manual seller service control unavailable`);
    const result = await this.poll(`document.querySelector('#seller-approval-status')?.textContent || ''`,
      (value) => /Registered [1-9][0-9]* seller plan\(s\)\. Manual pass complete\./.test(value)
        || /Approvals paused:/.test(value), 90_000, "manual seller plan service");
    if (!/Registered [1-9][0-9]* seller plan/.test(result)) {
      throw new Error(`${this.role}: seller plan service failed: ${result}`);
    }
  }
  async bid(title, amount, seller) {
    await this.waitAuctionCard(title);
    await this.waitActionEnabled("article.auction .actions button.button-primary", `${amount} bid`);
    const first = await this.auctionAction(title, "bid", amount);
    if (!first.ok) throw new Error(`${this.role}: ${first.reason}`);
    const firstResult = await this.poll(`(() => ({ message: document.querySelector('#message')?.textContent || '', label: [...document.querySelectorAll('article.auction')].find((node) => node.querySelector('h3')?.textContent === ${JSON.stringify(title)})?.querySelector('.actions button')?.textContent || '' }))()`,
      (value) => /Seller authorization pending|Threshold bid/.test(value?.message || '')
        || (/error|refused|failed|invalid|unavailable/i.test(value?.message || '') && value?.label !== 'Authorizing…'),
      120_000, `first ${amount} bid attempt`);
    if (/Seller authorization pending/.test(firstResult.message)) {
      await delay(RATE_SETTLE_MS);
      await seller.servicePendingPlan();
      await delay(RATE_SETTLE_MS);
      await this.waitActionEnabled("article.auction .actions button.button-primary", `${amount} retained bid`);
      const retry = await this.auctionAction(title, "bid", amount);
      if (!retry.ok) throw new Error(`${this.role}: retained bid retry controls missing: ${retry.reason}`);
    }
    const admitted = await this.poll(`document.querySelector('#message')?.textContent || ''`,
      (value) => /Threshold bid admitted/.test(value)
        || /rejected_return|error|refused|failed|invalid|unavailable/i.test(value),
      180_000, `${amount} bid admission`);
    if (!/Threshold bid admitted/.test(admitted)) throw new Error(`${this.role}: bid was not admitted: ${admitted}`);
    await this.poll(`fetch('/api/state', { credentials: 'same-origin', headers: { accept: 'application/json' } }).then((response) => response.json())`,
      (value) => Object.values(value?.state?.auctions || {}).some((auction) => auction.title === title && auction.high_bid === amount),
      60_000, `${amount} committed leader`);
  }
  async stopApprovals(title) {
    const action = await this.auctionAction(title, "approval");
    if (!action.ok) throw new Error(`${this.role}: ${action.reason}`);
    await this.poll(`document.querySelector('#seller-approval-status')?.textContent || ''`,
      (value) => /Seller approvals stopped|Pending returns/.test(value), 15_000, "seller approval stop");
  }
}

async function createPage(cdp, contextId, role, credential) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId: contextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await Promise.all([
    cdp.send("Page.enable", {}, sessionId),
    cdp.send("Runtime.enable", {}, sessionId),
    cdp.send("Network.enable", {}, sessionId),
  ]);
  // Five real participants arrive from separate networks. This single-host
  // acceptance runner shares one source IP, so suppress only the two passive
  // UI repaint/readiness intervals. Every mutation below still performs its
  // normal explicit refresh and all server-side limits remain unchanged.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: liveBrowserRequestPacingPrelude(SAME_ORIGIN_REQUEST_SPACING_MS),
  }, sessionId);
  const page = new DemoPage(cdp, sessionId, role);
  const connected = await page.open(credential);
  return { page, actor: connected.actor };
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "plebeian-live-auction-"));
  const recoveryMarker = "/tmp/plebeian-live-auction-recovery-location";
  const chromeArgs = [
    "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--metrics-recording-only", "about:blank",
  ];
  if (PROXY_SERVER) chromeArgs.splice(chromeArgs.length - 1, 0, `--proxy-server=${PROXY_SERVER}`);
  const chrome = spawn(CHROME, chromeArgs, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderr = ""; let success = false;
  chrome.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
  const cdp = new PipeCdp(chrome);
  const report = { schema: "PLEBEIAN_LIVE_FIVE_MEMBER_BROWSER_ACCEPTANCE_V1", site: SITE, status: "STARTED", phases: [] };
  try {
    const approved = credentials();
    const roles = ["seller", "bidder-a", "bidder-b", "bidder-c", "bidder-d"];
    const pages = [];
    for (let index = 0; index < roles.length; index += 1) {
      const { browserContextId } = await cdp.send("Target.createBrowserContext", {});
      const opened = await createPage(cdp, browserContextId, roles[index], approved[index]);
      pages.push({ ...opened, contextId: browserContextId, role: roles[index] });
      await delay(3000);
    }
    if (new Set(pages.map(({ actor }) => actor)).size !== 5) throw new Error("five browser profiles did not show distinct actor labels");
    report.phases.push({ phase: "five_signins", status: "PASS", actors: pages.map(({ role, actor }) => ({ role, actor })) });

    for (const entry of pages) {
      await entry.page.fund();
      await delay(RATE_SETTLE_MS);
    }
    report.phases.push({ phase: "five_fake_fundings", status: "PASS", amountEach: FUNDING });

    const title = `Live five-member test ${Date.now()}`;
    const auction = await pages[0].page.createAuction(title);
    report.phases.push({ phase: "auction_created", status: "PASS", auctionId: auction.id, title });
    await delay(RATE_SETTLE_MS);

    await pages[0].page.enableApprovals(title);
    report.phases.push({ phase: "seller_approvals_enabled", status: "PASS" });
    await delay(RATE_SETTLE_MS);

    for (let index = 0; index < BIDS.length; index += 1) {
      await pages[index + 1].page.bid(title, BIDS[index], pages[0].page);
      if (index > 0) {
        await pages[index].page.refreshView();
        await pages[index].page.poll(`document.querySelector('#spendable')?.textContent || ''`,
          (value) => Number(String(value).replace(/[^0-9-]/g, "")) === FUNDING, 90_000, "certified outbid return");
      }
      report.phases.push({ phase: `bid_${BIDS[index]}`, status: "PASS" });
      await delay(RATE_SETTLE_MS);
    }
    const closed = await pages[0].page.poll(`fetch('/api/state', { credentials: 'same-origin', headers: { accept: 'application/json' } }).then((response) => response.json())`,
      (value) => Object.values(value?.state?.auctions || {}).some((item) => item.title === title && item.status === 'closed'),
      900_000, "automatic close");
    const finalAuction = Object.values(closed.state.auctions).find((item) => item.title === title);
    report.phases.push({ phase: "automatic_close", status: "PASS", winnerPresent: Boolean(finalAuction.winner), highBid: finalAuction.high_bid });

    const expected = [10_400, 10_000, 10_000, 10_000, 9_600];
    const balances = [];
    for (let index = 0; index < pages.length; index += 1) {
      await pages[index].page.refreshView();
      const balance = await pages[index].page.poll(`(() => {
        const number = (id) => Number((document.querySelector(id)?.textContent || '').replace(/[^0-9-]/g, ''));
        return { available: number('#spendable'), locked: number('#locked'), pending: number('#refundable') };
      })()`, (value) => value?.available === expected[index] && value?.locked === 0 && value?.pending === 0,
      120_000, "terminal wallet balance");
      balances.push({ role: pages[index].role, ...balance });
    }
    const validators = await pages[0].page.validators();
    const observed = (validators.validators || []).filter((entry) => entry.online).length;
    if (observed !== 4) throw new Error(`validator evidence shows ${observed}/4 online`);
    report.phases.push({ phase: "terminal_balances", status: "PASS", balances, total: balances.reduce((sum, item) => sum + item.available, 0) });
    report.phases.push({ phase: "validator_evidence", status: "PASS", observed });
    report.status = "PASS"; success = true;
  } catch (error) {
    report.status = "FAIL"; report.error = error.message; report.browserDiagnosticPresent = Boolean(stderr);
    writeFileSync(recoveryMarker, `${profile}\n`, { mode: 0o600 }); chmodSync(recoveryMarker, 0o600);
    report.recoveryProfilePreserved = true;
  } finally {
    chrome.kill("SIGTERM"); await delay(500); if (!chrome.killed) chrome.kill("SIGKILL");
    if (success) { rmSync(profile, { recursive: true, force: true }); rmSync(recoveryMarker, { force: true }); }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!success) process.exitCode = 1;
}

await main();
