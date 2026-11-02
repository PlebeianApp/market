const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Element {
  constructor() { this.children = []; this.textContent = ''; this.dataset = {}; this.value = ''; this.disabled = false; }
  append(...nodes) { this.children.push(...nodes); } replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, value) { this[k] = value; } get lastChild() { return this.children.at(-1); } reset() {}
}
const pause = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 12; i++) await pause(); }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function fixture(ready = true) {
  const nodes = new Map(), timers = new Map(), intervals = [], requests = [];
  let now = 1800000000000, timerId = 0, available = ready, failConfig = false, gate = null, connected = 0, imports = 0, demoCreated = 0;
  const pins = { schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1', deployment_id: 'deployment-one', auth_network_id: 'chain', chain_id: 'chain',
    genesis_sha256: 'a'.repeat(64), cashu_mint_url: 'https://mint.example', committee_keyset_id: 'keyset', committee_keyset_version: '1',
    dkg_run_id: 'dkg', committee_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    public_key_package_sha256: 'b'.repeat(64), signer_roster_digest: 'c'.repeat(64), fake_funding_policy_digest: 'd'.repeat(64) };
  const configChange = {}, get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const config = () => ({ ...pins, fake_funding_policy: { digest: pins.fake_funding_policy_digest }, threshold_custody: true,
    browser_threshold_wallet_ready: available, browser_threshold_admission_ready: available, recovery_only: false, ...configChange });
  const actor = 'a'.repeat(64), controller = { actor: async () => actor, pendingFakeFunding: async () => null,
    importAvailable: async () => { imports++; return { refunds: 0, winnerPayments: 0 }; },
    balance: async () => ({ available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0 }),
    serviceSellerPlans: async () => ({ registered: 0, operations: [] }) };
  const fakeDate = class extends Date { static now() { return now; } };
  const context = vm.createContext({
    window: { plebeianCreateDemoSigner: () => { demoCreated++; return { getPublicKey: async () => actor, signEvent: async () => { throw new Error("unused"); } }; }, nostr: { getPublicKey: async () => actor, signEvent: async () => { throw new Error('unused'); } },
      plebeianFridayR20Connect: async ({ pins: captured }) => { connected++; assert.equal(captured.environmentId, pins.deployment_id); return controller; } },
    document: { getElementById: get, createElement: () => new Element(), createTextNode: text => ({ textContent: text }) },
    fetch: async url => {
      requests.push(url);
      if (url === '/api/config' && gate) await gate.promise; // deliberately ignores AbortSignal for late-result test
      if (url === '/api/config' && failConfig) throw new Error('config unavailable');
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(
        url === '/api/config' ? config() : url === '/api/browser-release-pins' ? pins : url === '/api/validators' ? { validators: [] }
          : { state: { auctions: {}, bids: {}, height: 10 } }) };
    },
    setInterval: (run, ms) => intervals.push({ run, ms }),
    setTimeout: (run, ms) => { const id = ++timerId; timers.set(id, { run, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id), Date: fakeDate, AbortController, structuredClone, console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/ui-helpers.js'), 'utf8'), context);
  const app = process.env.HLT_UI_APP || path.join(__dirname, 'static/app.js');
  vm.runInContext(fs.readFileSync(app, 'utf8'), context);
  const run = source => vm.runInContext(source, context);
  await settle();
  return { run, get, pins, configChange, requests, timers, intervals,
    available(value) { available = value; }, failure(value) { failConfig = value; }, hold(value) { gate = value; },
    connected: () => connected, imports: () => imports, demoCreated: () => demoCreated,
    async advance(ms = 4000) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); } await settle(); },
    async refresh() { await run('refresh()'); await settle(); },
  };
}

test('cold warmup loads independent pins, then ordinary login works after restoration without reload', async () => {
  const f = await fixture(false);
  assert.ok(f.requests.includes('/api/browser-release-pins'));
  await assert.rejects(() => f.run('connect()'), /not active/); assert.equal(f.connected(), 0);
  f.available(true); await f.advance(); await f.refresh(); await f.run('connect()');
  assert.equal(f.connected(), 1); assert.equal(f.get('faucet').disabled, false);
});
test('ready -> degraded -> recovered updates controls and retains safe imports on the existing controller', async () => {
  const f = await fixture(); await f.run('connect()'); const imports = f.imports();
  f.available(false); await f.advance(); await f.refresh();
  assert.equal(f.get('faucet').disabled, true); assert.equal(f.get('create-submit').disabled, true);
  assert.ok(f.imports() > imports); assert.ok(f.run('state.friday'));
  f.available(true); await f.advance(); await f.refresh();
  assert.equal(f.get('faucet').disabled, false); assert.equal(f.connected(), 1);
});
test('configuration failures close controls; recovery cannot use an identity copied from runtime config', async () => {
  const f = await fixture(); await f.run('connect()');
  f.configChange.chain_id = 'wrong-chain'; await f.advance(); await f.refresh();
  assert.equal(f.get('faucet').disabled, true); assert.equal(f.run('state.friday'), null); assert.equal(f.run('state.actor'), '');
  await assert.rejects(() => f.run('connect()'), /not active/);
  delete f.configChange.chain_id; await f.advance(); await f.refresh();
  assert.equal(f.run('state.friday'), null); await f.run('connect()'); assert.equal(f.connected(), 2);
});
test('independent release changes disconnect the prior controller before any new wallet use', async () => {
  const f = await fixture(); await f.run('connect()'); const before = f.imports(), generation = f.run('state.generation');
  f.pins.deployment_id = 'deployment-two'; await f.advance(); await f.refresh();
  assert.equal(f.run('state.friday'), null); assert.equal(f.run('state.actor'), ''); assert.ok(f.run('state.generation') > generation);
  assert.equal(f.imports(), before); await f.run('connect()'); assert.equal(f.connected(), 2);
});
test('missing or malformed independent identity stays closed', async () => {
  const f = await fixture(); f.pins.genesis_sha256 = 'unknown'; await f.advance(); await f.refresh();
  await assert.rejects(() => f.run('connect()'), /not active/); assert.equal(f.connected(), 0);
});
test('refresh/login share one readiness request and backoff bounds repeated failed retries', async () => {
  const f = await fixture(false), first = f.requests.filter(url => url === '/api/config').length;
  await Promise.all(Array.from({ length: 40 }, () => f.run('refreshReadiness()')));
  await Promise.all(Array.from({ length: 40 }, () => f.run('connect()').catch(() => undefined)));
  assert.equal(f.requests.filter(url => url === '/api/config').length, first);
  // Transport errors, rather than validated warming responses, grow backoff.
  f.failure(true); const gate = deferred(); f.hold(gate); await f.advance();
  const requests = Array.from({ length: 40 }, () => f.run('refreshReadiness()'));
  await settle(); assert.equal(f.requests.filter(url => url === '/api/config').length, first + 1);
  gate.resolve(); await Promise.all(requests); f.hold(null);
  for (const delay of [8000, 16000, 30000, 30000]) { await f.advance(delay); await f.refresh(); }
  assert.equal(f.run('state.readinessFailures'), 4);
  assert.equal(f.requests.filter(url => url === '/api/config').length, first + 5);
});
test('a timed-out readiness reply stays closed even if its ignored-abort response arrives later', async () => {
  const f = await fixture(), gate = deferred(); await f.run('connect()');
  f.hold(gate); await f.advance(); const checking = f.run('refreshReadiness()'); await settle();
  await f.advance(8000); assert.equal(await checking, false); assert.equal(f.get('faucet').disabled, true);
  gate.resolve(); await settle(); assert.equal(f.run('r20RuntimeReady()'), false);
  f.hold(null); await f.advance(); await f.refresh(); assert.equal(f.get('faucet').disabled, false);
});
test('ordinary fetch failure preserves the existing recovery controller while admission stays disabled', async () => {
  const f = await fixture(); await f.run('connect()'); const before = f.imports();
  f.failure(true); await f.advance(); await f.refresh();
  assert.equal(f.get('faucet').disabled, true); assert.ok(f.run('state.friday')); assert.ok(f.imports() > before);
});
test('seller consent is revoked on readiness loss/restoration and release identity change', async t => {
  const f = await fixture();
  if (!f.run('typeof stopSellerApprovals === "function"')) { t.skip('Runs on the separately frozen CFG/PAY compatibility overlay.'); return; }
  await f.run('connect()');
  f.run('state.sellerAuctions.add("a1"); state.approvalAbort = new AbortController(); globalThis.oldApproval = state.approvalAbort;');
  const revision = f.run('state.approvalRevision'); f.available(false); await f.advance(); await f.refresh();
  assert.equal(f.run('oldApproval.signal.aborted'), true); assert.equal(f.run('state.sellerAuctions.size'), 0);
  assert.ok(f.run('state.approvalRevision') > revision);
  f.available(true); await f.advance(); await f.refresh(); assert.equal(f.run('state.sellerAuctions.size'), 0);
  f.run('state.sellerAuctions.add("a1");'); f.pins.deployment_id = 'another'; await f.advance(); await f.refresh();
  assert.equal(f.run('state.sellerAuctions.size'), 0); assert.equal(f.run('state.friday'), null);
});

test('automatic identity invalidation retains the tab-local signer for explicit reconnect', async () => {
  const f = await fixture(); await f.run('connectDemo()'); f.run('globalThis.originalDemoSigner = state.signer');
  assert.equal(f.demoCreated(), 1);
  f.pins.deployment_id = 'deployment-two'; await f.advance(); await f.refresh();
  assert.equal(f.run('state.friday'), null); assert.equal(f.run('state.actor'), '');
  assert.equal(f.run('state.signer === originalDemoSigner'), true);
  await f.run('connectDemo()'); assert.equal(f.demoCreated(), 1); assert.equal(f.connected(), 2);
});
