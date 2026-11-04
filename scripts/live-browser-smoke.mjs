#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/home/maximoto/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome";
const CREDENTIALS = "/home/maximoto/Documents/Codex/2026-10-30/task-2/app-https-public-demo-activation-r1/DEMO-CREDENTIALS.txt";
const SITE = "https://139.162.161.233/";

function demoCredential(name) {
  const lines = readFileSync(CREDENTIALS, "utf8").split(/\r?\n/).filter(Boolean);
  const line = lines.find((candidate) => candidate.startsWith(`${name}:`));
  if (!line) throw new Error(`approved ${name} credential is unavailable`);
  const separator = line.indexOf(":");
  const username = line.slice(0, separator);
  const password = line.slice(separator + 1);
  if (username !== name || password.length < 20) throw new Error(`approved ${name} credential is malformed`);
  return { username, password };
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
        if (waiter.method !== message.method || (waiter.sessionId && waiter.sessionId !== message.sessionId)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message.params ?? {});
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.input.write(`${JSON.stringify(message)}\0`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  event(method, sessionId, timeoutMs = 15000) {
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

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed");
  return result.result?.value;
}

async function poll(cdp, sessionId, expression, accept, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(cdp, sessionId, expression);
    if (accept(value)) return value;
    await delay(250);
  }
  throw new Error(`browser state did not settle (last state: ${JSON.stringify(value)})`);
}

async function main() {
  const { username, password } = demoCredential("demo-1");
  const profile = mkdtempSync(join(tmpdir(), "plebeian-browser-smoke-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--metrics-recording-only",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
  const cdp = new PipeCdp(chrome);
  let actionDiagnostic = null;
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await Promise.all([
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Runtime.enable", {}, sessionId),
      cdp.send("Network.enable", {}, sessionId),
    ]);
    const authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
    await cdp.send("Network.setExtraHTTPHeaders", { headers: { Authorization: authorization } }, sessionId);
    const loaded = cdp.event("Page.loadEventFired", sessionId, 20000);
    const navigation = await cdp.send("Page.navigate", { url: SITE }, sessionId);
    if (navigation.errorText) throw new Error(`navigation failed: ${navigation.errorText}`);
    await loaded;
    const boot = await poll(cdp, sessionId, `(() => ({
      title: document.title,
      url: location.href,
      signer: typeof globalThis.plebeianCreateDemoSigner,
      connector: typeof globalThis.plebeianFridayR20Connect,
      actor: document.querySelector('#actor')?.textContent || '',
      message: document.querySelector('#message')?.textContent || '',
      login: Boolean(document.querySelector('#demo-login')),
      handler: typeof document.querySelector('#demo-login')?.onclick,
      ready: !document.querySelector('#demo-login')?.disabled
    }))()`, (value) => value?.signer === "function" && value?.connector === "function" && value?.login
      && value?.handler === "function" && value?.message === "Runtime ready. Connect an identity or continue.", 30000);
    actionDiagnostic = await evaluate(cdp, sessionId, `(async () => {
      const history = [];
      const target = document.querySelector('#message');
      const observer = new MutationObserver(() => history.push(target?.textContent || ''));
      if (target) observer.observe(target, { childList: true, characterData: true, subtree: true });
      await document.querySelector('#demo-login').onclick();
      await new Promise((resolve) => setTimeout(resolve, 250));
      observer.disconnect();
      return {
        actor: document.querySelector('#actor')?.textContent || '',
        message: target?.textContent || '',
        history: history.slice(-8)
      };
    })()`);
    const signedIn = await poll(cdp, sessionId, `(() => ({
      actor: document.querySelector('#actor')?.textContent || '',
      message: document.querySelector('#message')?.textContent || '',
      fundDisabled: document.querySelector('#faucet')?.disabled ?? true,
      createDisabled: document.querySelector('#create-submit')?.disabled ?? true,
      auctions: document.querySelectorAll('article.auction').length,
      spendable: document.querySelector('#spendable')?.textContent || ''
    }))()`, (value) => value?.actor.startsWith("tab-local demo signer · ") || /error|failed|unavailable|did not load/i.test(value?.message || ""), 45000);
    const deploymentDiagnostic = /deployment cryptographic identity is malformed/.test(signedIn.message)
      ? await evaluate(cdp, sessionId, `(async () => {
          const response = await fetch('/api/friday/deployment', {
            method: 'POST', redirect: 'error', credentials: 'same-origin',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_READ_V1' })
          });
          const value = await response.json();
          const point = /^(02|03)[0-9a-f]{64}$/;
          const hash = /^[0-9a-f]{64}$/;
          const id = /^[A-Za-z0-9_-]{1,160}$/;
          const entries = Object.entries(value?.keyset?.keys || {}).sort(([left], [right]) => {
            const a = BigInt(left), b = BigInt(right); return a < b ? -1 : a > b ? 1 : 0;
          });
          const bytes = new TextEncoder().encode(JSON.stringify(entries));
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map((byte) => byte.toString(16).padStart(2, '0')).join('');
          const amounts = entries.map(([amount]) => Number(amount));
          const snapshot = value?.mintSnapshot || {};
          const participants = value?.participants || [];
          return {
            httpStatus: response.status,
            checks: {
              schema: value?.schema === 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1',
              ids: ['environmentId','authNetworkId','chainId','committeeKeysetId','committeeKeysetVersion','dkgRunId'].every((key) => id.test(String(value?.[key]))),
              hashes: ['genesisSha256','publicKeyPackageSha256','signerRosterDigest'].every((key) => hash.test(String(value?.[key]))),
              committeePoint: point.test(String(value?.committeePublicKey)),
              participants: participants.length === 4 && participants.every((entry, index) => entry?.identifier === index + 1 && point.test(String(entry?.verifyingShare))),
              mintOriginMatch: snapshot.mintUrl === value?.canonicalMintUrl,
              mintPoint: point.test(String(snapshot.mintPublicKey)),
              serverVersion: typeof snapshot.serverVersion === 'string' && snapshot.serverVersion.length > 0 && snapshot.serverVersion.length <= 160,
              keysetId: snapshot.activeSatKeysetId === value?.keyset?.id,
              denominationDigest: snapshot.denominationKeyDigest === digest,
              denominationAmounts: JSON.stringify([...(snapshot.denominationAmounts || [])].sort((a,b) => a-b)) === JSON.stringify(amounts),
              zeroFee: snapshot.inputFeePpk === 0,
              requiredNuts: [4,7,9,10,11,12].every((nut) => (snapshot.nuts || []).includes(nut)),
              keyPoints: entries.length > 0 && entries.every(([amount, key]) => /^[1-9][0-9]*$/.test(amount) && point.test(String(key)))
            },
            snapshot: {
              nuts: snapshot.nuts,
              denominationAmounts: snapshot.denominationAmounts,
              keysetAmounts: amounts,
              activeSatKeysetId: snapshot.activeSatKeysetId,
              keysetId: value?.keyset?.id,
              mintUrl: snapshot.mintUrl,
              canonicalMintUrl: value?.canonicalMintUrl
            }
          };
        })()`)
      : null;
    const ok = signedIn.actor.startsWith("tab-local demo signer · ") && !signedIn.fundDisabled && !signedIn.createDisabled;
    const report = {
      schema: "PLEBEIAN_LIVE_BROWSER_SIGNIN_SMOKE_V1",
      site: SITE,
      authenticated: boot.title === "Plebeian Auctions",
      moduleSignerLoaded: boot.signer === "function",
      moduleConnectorLoaded: boot.connector === "function",
      demoIdentityConnected: signedIn.actor.startsWith("tab-local demo signer · "),
      fundingEnabled: signedIn.fundDisabled === false,
      auctionCreationEnabled: signedIn.createDisabled === false,
      auctionCount: signedIn.auctions,
      spendableLabel: signedIn.spendable,
      message: signedIn.message,
      deploymentDiagnostic,
      status: ok ? "PASS" : "FAIL",
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schema: "PLEBEIAN_LIVE_BROWSER_SIGNIN_SMOKE_V1", status: "ERROR", error: error.message, actionDiagnostic, browserDiagnosticPresent: Boolean(stderr) }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    chrome.kill("SIGTERM");
    await delay(250);
    if (!chrome.killed) chrome.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  }
}

await main();
