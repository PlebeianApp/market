const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// A3 desired regressions on the current HLT UI. Harness-only updates provide complete independent pins, browser AbortController/timers, and 4s fake-clock advancement for bounded refresh. Assertions unchanged.
class Element {
  constructor() { this.children = []; this.textContent = ''; this.dataset = {}; this.value = ''; this.disabled = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this[k] = v; }
  get lastChild() { return this.children.at(-1); }
}
const pause = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i++) await pause(); }
async function fixture(initialReady) {
  const nodes = new Map(), requests = [], intervals = [];
  let available = initialReady, connected = 0, now = 1800000000000;
  const pins = { schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1', deployment_id: 'deployment', auth_network_id: 'chain', chain_id: 'chain',
    genesis_sha256: 'a'.repeat(64), cashu_mint_url: 'https://mint.example', committee_keyset_id: 'keyset', committee_keyset_version: '1',
    dkg_run_id: 'dkg', committee_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    public_key_package_sha256: 'b'.repeat(64), signer_roster_digest: 'c'.repeat(64), fake_funding_policy_digest: 'd'.repeat(64) };
  const fakeDate = class extends Date { static now() { return now; } };
  const element = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const config = () => ({ ...pins, fake_funding_policy: { digest: pins.fake_funding_policy_digest }, threshold_custody: true, browser_threshold_wallet_ready: available,
    browser_threshold_admission_ready: available, recovery_only: false, deployment_id: 'deployment' });
  const context = vm.createContext({
    window: { nostr: { getPublicKey: async () => 'a'.repeat(64), signEvent: async () => { throw new Error('unused'); } },
      plebeianFridayR20Connect: async () => { connected++; return {
        actor: async () => 'a'.repeat(64), // PAY controller identity seam; assertions unchanged.
        pendingFakeFunding: async () => null, importAvailable: async () => ({ refunds: 0, winnerPayments: 0 }),
        balance: async () => ({ available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0 }),
      }; } },
    document: { getElementById: element, createElement: () => new Element(), createTextNode: text => ({ textContent: text }) },
    fetch: async url => { requests.push(url); return { ok: true, headers: { get: () => 'application/json' },
      json: async () => url.startsWith('/api/state') ? { state: { auctions: {}, bids: {}, height: 10 } }
        : url === '/api/validators' ? { validators: [] } : url === '/api/browser-release-pins' ? pins : config() }; },
    setInterval: (run, ms) => intervals.push({ run, ms }), Date: fakeDate, console, AbortController, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/ui-helpers.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  await settle();
  return { requests, run, connected: () => connected, restore: () => { available = true; now += 4000; },
    async refresh() { await run('refresh()'); for (const timer of intervals.filter(t => t.ms === 4000)) timer.run(); await settle(); } };
}
test('control: initially ready boot connects and loads independent release pins', async () => {
  const f = await fixture(true); await f.run('connect()');
  assert.equal(f.connected(), 1); assert.ok(f.requests.includes('/api/browser-release-pins'));
});
test('regression: cold warming tab must resample readiness on refresh', async () => {
  const f = await fixture(false); f.restore(); await f.refresh(); await f.refresh();
  assert.ok(f.requests.filter(url => url === '/api/config').length >= 2, 'readiness was never refreshed after cold false');
});
test('regression: restored readiness should permit the ordinary login without full reload', async () => {
  const f = await fixture(false); f.restore(); await f.refresh();
  await assert.doesNotReject(() => f.run('connect()'));
  assert.equal(f.connected(), 1);
});
