const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Execute the ordinary UI, with only DOM/network/controller boundaries mocked.
// No browser extension, mint, Comet, Coco wallet or real Nostr signer is used.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.textContent = ''; this.dataset = {}; this.value = ''; this.disabled = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this[key] = value; }
  get lastChild() { return this.children.at(-1); }
  reset() {}
}
const actor = 'aa'.repeat(32), otherActor = 'bb'.repeat(32);
const pause = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i++) await pause(); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function fixture() {
  const nodes = new Map(), get = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  let now = 1800000000000, timerId = 0, owner = actor;
  const timers = new Map();
  const calls = { imports: 0, services: 0, signs: 0, registered: 0, balance: 0, lostResponse: false, deny: false, gate: null };
  const auction = (id) => ({ id, seller: actor, status: 'open', title: id, created_at: 1, end_time: 1900000000,
    original_end_time: 1900000000, high_bid: 0, min_increment: 100, starting_bid: 100, reserve: 0 });
  const view = { state: { auctions: { a1: auction('a1'), a2: auction('a2') }, bids: {}, height: 1 } };
  const pending = [{ auctionId: 'a1', fundingOperationId: 'f1', bidderActor: otherActor, bidAmount: 600, expiresAt: 1900000000 }];
  const completed = new Set();
  const controller = {
    async actor() { return owner; }, async pendingFakeFunding() { return null; },
    async importAvailable() { calls.imports++; return { refunds: 0, winnerPayments: 0 }; },
    async balance() { calls.balance++; return { available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0 }; },
    async serviceSellerPlans(options) {
      calls.services++;
      const operations = [];
      for (const plan of pending) {
        if (!options.auctionIds.includes(plan.auctionId) || completed.has(plan.fundingOperationId)) continue;
        await options.assertActive(); options.onPlan(plan); calls.signs++;
        if (calls.deny) throw new Error('NIP-07 denied / unavailable');
        if (calls.gate) await Promise.race([calls.gate.promise, new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('approval cancelled')), { once: true }))]);
        await options.assertActive();
        calls.registered++; completed.add(plan.fundingOperationId); operations.push(plan.fundingOperationId);
        if (calls.lostResponse) throw new Error('registration response lost');
      }
      return { registered: operations.length, operations };
    },
  };
  // Harness-only complete independent pin fixture required by HLT identity refresh.
  const pins = { schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1', deployment_id: 'deployment-one', auth_network_id: 'chain', chain_id: 'chain',
    genesis_sha256: 'a'.repeat(64), cashu_mint_url: 'https://mint.example', committee_keyset_id: 'keyset', committee_keyset_version: '1',
    dkg_run_id: 'dkg', committee_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    public_key_package_sha256: 'b'.repeat(64), signer_roster_digest: 'c'.repeat(64), fake_funding_policy_digest: 'd'.repeat(64) };
  const config = { ...pins, fake_funding_policy: { digest: pins.fake_funding_policy_digest }, threshold_custody: true,
    browser_threshold_wallet_ready: true, browser_threshold_admission_ready: true, recovery_only: false };
  const signer = { async getPublicKey() { return owner; }, async signEvent() { throw new Error('UI must use controller'); } };
  const fakeDate = class extends Date { static now() { return now; } };
  const context = vm.createContext({
    window: { nostr: signer, plebeianFridayR20Connect: async () => controller },
    document: { getElementById: get, createElement: (tag) => new Element(tag), createTextNode: (text) => ({ textContent: text }) },
    fetch: async (url) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(url.startsWith('/api/state') ? view : url === '/api/validators' ? { validators: [] } : url === '/api/browser-release-pins' ? pins : config) }),
    setInterval() {}, setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, Date: fakeDate, AbortController, structuredClone, console,
    localStorage: { getItem() { throw new Error('approval consent must not persist'); }, setItem() { throw new Error('approval consent must not persist'); } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/ui-helpers.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8'), context);
  const run = (source) => vm.runInContext(source, context);
  await settle(); await run('connect()'); await settle();
  return { calls, get, view, pending, controller, run, setOwner(value) { owner = value; },
    async tick(milliseconds = 4000) { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await settle(); await run('refresh()'); await settle(); } };
}

test('default off and reload never sign; passive refund/payout import continues', async () => {
  for (let i = 0; i < 2; i++) {
    const held = await fixture(); await held.tick(); await held.tick();
    assert.equal(held.calls.signs, 0); assert.ok(held.calls.imports >= 3);
    assert.equal(held.run('state.sellerAuctions.size'), 0);
  }
});

test('explicit auction opt-in presents the exact bidder/amount and registers only that auction', async () => {
  const held = await fixture(); held.calls.gate = deferred();
  held.pending.push({ ...held.pending[0], auctionId: 'a2', fundingOperationId: 'f2' });
  held.run('toggleSellerApprovals("a1")'); await settle();
  assert.match(held.get('seller-approval-status').textContent, /auction a1, bidder b{64}, 600 fake sats, operation f1/);
  assert.equal(held.calls.signs, 1); held.calls.gate.resolve(); await settle();
  await held.tick(); assert.equal(held.calls.registered, 1); assert.equal(held.calls.signs, 1);
});

test('denial pauses until a fresh seller gesture; timer/refresh never reprompt', async () => {
  const held = await fixture(); held.calls.deny = true;
  held.run('toggleSellerApprovals("a1")'); await settle();
  assert.equal(held.calls.signs, 1); assert.match(held.get('seller-approval-status').textContent, /paused.*No automatic retry/);
  for (let i = 0; i < 8; i++) await held.tick(60000);
  assert.equal(held.calls.signs, 1); assert.ok(held.calls.imports > 8);
  held.calls.deny = false; await held.run('servicePayments()'); await settle();
  assert.equal(held.calls.signs, 2); assert.equal(held.calls.registered, 1);
  assert.equal(held.run('state.sellerAuctions.size'), 0);
});

test('one unresolved prompt across concurrent refresh and repeated clicks; stop discards late result', async () => {
  const held = await fixture(); const gate = held.calls.gate = deferred();
  held.run('toggleSellerApprovals("a1")'); await settle();
  const balanceCalls = held.calls.balance;
  await Promise.all([held.run('refresh()'), held.run('refresh()')]);
  assert.equal(held.calls.balance, balanceCalls);
  held.run('serviceSellerApprovals(false)'); await settle(); assert.equal(held.calls.signs, 1);
  held.get('stop-seller-approvals').onclick(); await settle();
  assert.equal(held.run('state.maintenancePromise'), null); await held.tick();
  gate.resolve(); await settle(); assert.equal(held.calls.registered, 0); assert.equal(held.calls.signs, 1);
});

test('60-second unavailable-signer timeout pauses and releases passive recovery', async () => {
  const held = await fixture(); held.calls.gate = deferred();
  held.run('toggleSellerApprovals("a1")'); await settle();
  await held.tick(60000); assert.equal(held.calls.signs, 1); assert.equal(held.calls.registered, 0);
  assert.equal(held.run('state.maintenancePromise'), null); assert.match(held.get('seller-approval-status').textContent, /paused/);
  const imports = held.calls.imports; await held.tick(); assert.ok(held.calls.imports > imports);
});

test('disconnect and reconnect to the same actor cannot revive stale consent', async () => {
  const held = await fixture(); const gate = held.calls.gate = deferred();
  held.run('toggleSellerApprovals("a1")'); await settle();
  held.get('disconnect').onclick(); await held.run('connect()'); await settle();
  gate.resolve(); await settle(); await held.tick();
  assert.equal(held.calls.registered, 0); assert.equal(held.calls.signs, 1); assert.equal(held.run('state.sellerAuctions.size'), 0);
});

test('toggling away and back cannot revive an old attempt', async () => {
  const held = await fixture(); const gate = held.calls.gate = deferred();
  held.run('toggleSellerApprovals("a1")'); await settle();
  held.run('toggleSellerApprovals("a1"); toggleSellerApprovals("a1")'); await settle();
  gate.resolve(); await settle(); assert.equal(held.calls.registered, 0);
});

for (const change of ['actor', 'deployment', 'auction']) {
  test(`${change} change during approval aborts registration and pauses consent`, async () => {
    const held = await fixture(); const gate = held.calls.gate = deferred();
    held.run('toggleSellerApprovals("a1")'); await settle();
    if (change === 'actor') held.setOwner(otherActor);
    if (change === 'deployment') held.run('state.releasePins.deployment_id = "different"');
    if (change === 'auction') held.view.state.auctions.a1.status = 'closed';
    if (change === 'auction') await held.run('refresh()');
    gate.resolve(); await settle();
    assert.equal(held.calls.registered, 0); assert.equal(held.run('state.sellerAuctions.size'), 0);
  });
}

test('manual button double-click is single-flight and does not opt in future bids', async () => {
  const held = await fixture(); const gate = held.calls.gate = deferred();
  const button = held.get('process-payments');
  const first = button.onclick({ currentTarget: button }); const second = button.onclick({ currentTarget: button });
  await settle(); assert.equal(held.calls.signs, 1); gate.resolve(); await Promise.all([first, second]);
  assert.equal(held.calls.registered, 1); held.pending.push({ ...held.pending[0], fundingOperationId: 'f2' });
  await held.tick(); assert.equal(held.calls.signs, 1);
});

test('already-submitted registration remains recoverable after lost response or stop', async () => {
  const held = await fixture(); held.calls.lostResponse = true;
  held.run('toggleSellerApprovals("a1")'); await settle();
  assert.equal(held.calls.registered, 1); held.get('stop-seller-approvals').onclick(); await held.tick();
  assert.equal(held.calls.signs, 1); assert.ok(held.calls.imports >= 2);
  held.calls.lostResponse = false; await held.run('servicePayments()');
  assert.equal(held.calls.signs, 1); assert.equal(held.calls.registered, 1);
});


test('balance-first opt-in, manual and timer attempts wait for the shared maintenance slot', async () => {
  const held = await fixture(), gate = deferred(), entered = deferred();
  held.controller.balance = async () => { entered.resolve(); await gate.promise; return { available:0,reserved:0,locked:0,pending:0,unresolved:0 }; };
  const refresh = held.run('refresh()'); await entered.promise;
  held.run('toggleSellerApprovals("a1")'); await settle();
  held.run('serviceSellerApprovals(false)'); await settle();
  assert.equal(held.calls.services, 0);
  const manual = held.run('servicePayments()'); await settle(); assert.equal(held.calls.services,0);
  gate.resolve(); await refresh; await manual; await settle();
  assert.equal(held.calls.signs,1); assert.equal(held.calls.registered,1);
});

test('timeout releases the UI request despite an uncooperative opener; late continuation is guarded', async () => {
  const held = await fixture(), gate = deferred(), entered = deferred();
  let lateEffects = 0;
  held.controller.serviceSellerPlans = async (options) => {
    entered.resolve(); await gate.promise; await options.assertActive(); lateEffects++;
    return { registered:0,operations:[] };
  };
  held.run('toggleSellerApprovals("a1")'); await entered.promise; await settle();
  const imports = held.calls.imports;
  await held.tick(60000); await held.tick();
  assert.equal(held.run('state.maintenancePromise'), null); assert.ok(held.calls.imports > imports);
  gate.resolve(); await settle(); assert.equal(lateEffects,0);
});

test('Stop cancels a manual pass queued behind balance without clearing balance ownership', async () => {
  const held = await fixture(), gate = deferred(), entered = deferred();
  held.controller.balance = async () => { entered.resolve(); await gate.promise; return { available:0,reserved:0,locked:0,pending:0,unresolved:0 }; };
  const refresh = held.run('refresh()'); await entered.promise;
  // Invoke the UI click handler without awaiting its queued manual pass.
  const button = held.get('process-payments'), manual = button.onclick({ currentTarget:button });
  await settle(); held.get('stop-seller-approvals').onclick(); await settle();
  assert.equal(held.calls.services,0); assert.notEqual(held.run('state.maintenancePromise'),null);
  gate.resolve(); await refresh; await manual; await settle(); assert.equal(held.calls.services,0);
});
