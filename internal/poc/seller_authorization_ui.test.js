const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  static activeElement = null;
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.textContent = ''; this.dataset = {};
    this.value = ''; this.disabled = false; this.validationMessage = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this[key] = value; }
  setCustomValidity(value) { this.validationMessage = value; }
  focus() { Element.activeElement = this; }
  get lastChild() { return this.children.at(-1); }
  reset() {}
}

const actor = 'aa'.repeat(32), otherActor = 'bb'.repeat(32);
const pause = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i += 1) await pause(); }
function findNode(node, accept) {
  if (accept(node)) return node;
  return (node?.children || []).map(child => findNode(child, accept)).find(Boolean);
}

async function fixture({ auctionSeller = actor, bidStatus = 'admitted', rejectAuthorization = false,
  staleStateReadsAfterCreate = 0 } = {}) {
  const nodes = new Map(), get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  let now = 1800000000000;
  const calls = { imports: 0, sellerPlans: 0, listingSigns: 0, authorizations: [], bids: [], rejectAuthorization };
  const registeredPayouts = new Set();
  if (auctionSeller === actor) registeredPayouts.add('a1');
  const auction = { id: 'a1', seller: auctionSeller, status: 'open', title: 'a1', created_at: 1,
    end_time: 1900000000, original_end_time: 1900000000, high_bid: 0, leader_bid_id: '',
    min_increment: 100, starting_bid: 100, reserve: 0 };
  const view = { state: { auctions: { a1: auction }, bids: {}, height: 1 } };
  let staleView = null, staleStateReads = 0;
  const controller = {
    async actor() { return actor; },
    async pendingFakeFunding() { return null; },
    async sellerPaymentPublicKey() { return '02' + 'cc'.repeat(32); },
    async readAuctionPayout(auctionId) {
      return registeredPayouts.has(auctionId) ? { authorization: { auctionId } } : null;
    },
    async authorizeAuctionPayout(value) {
      calls.authorizations.push(structuredClone(value));
      if (calls.rejectAuthorization) throw new Error('authorization denied');
      registeredPayouts.add(value.auctionId);
      return { authorizationDigest: 'dd'.repeat(32) };
    },
    async placeBid(value) {
      calls.bids.push(structuredClone(value));
      return bidStatus === 'seller_plan_pending'
        ? { status: bidStatus, fundingOperationId: 'legacy-prelock-operation' }
        : { status: bidStatus, fundingOperationId: 'bid-operation', committedHeight: 3 };
    },
    async importAvailable() { calls.imports += 1; return { refunds: 0, winnerPayments: 0 }; },
    async balance() { return { available: 1000, reserved: 0, locked: 0, pending: 0, unresolved: 0 }; },
    async expiredPrelockPending() { return []; },
    async serviceSellerPlans() { calls.sellerPlans += 1; throw new Error('legacy per-bid seller service must not run'); },
  };
  const pins = { schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1', deployment_id: 'deployment-one', auth_network_id: 'chain', chain_id: 'chain',
    genesis_sha256: 'a'.repeat(64), cashu_mint_url: 'https://mint.example', committee_keyset_id: 'keyset', committee_keyset_version: '1',
    dkg_run_id: 'dkg', committee_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    public_key_package_sha256: 'b'.repeat(64), signer_roster_digest: 'c'.repeat(64), fake_funding_policy_digest: 'd'.repeat(64) };
  const config = { ...pins, fake_funding_policy: { digest: pins.fake_funding_policy_digest }, threshold_custody: true,
    browser_threshold_wallet_ready: true, browser_threshold_admission_ready: true, recovery_only: false };
  const signer = { async getPublicKey() { return actor; }, async signEvent(value) {
    calls.listingSigns += 1; return { ...structuredClone(value), id: 'ee'.repeat(32), sig: 'ff'.repeat(64) };
  } };
  const document = { getElementById: get, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) };
  Object.defineProperty(document, 'activeElement', { get: () => Element.activeElement });
  const context = vm.createContext({
    window: { nostr: signer, plebeianFridayR20Connect: async () => controller, confirm: () => true }, document,
    fetch: async (url, init) => {
      if (url === '/api/event') {
        staleView = structuredClone(view); staleStateReads = staleStateReadsAfterCreate;
        const signed = JSON.parse(init.body), listing = JSON.parse(signed.content), committedAt = Math.floor(now / 1000);
        view.state.auctions[listing.auction_id] = { id: listing.auction_id, seller: actor, status: 'open', title: listing.title,
          description: listing.description, image_url: listing.image_url, created_at: committedAt,
          original_end_time: committedAt + listing.duration_seconds, end_time: committedAt + listing.duration_seconds,
          high_bid: 0, leader_bid_id: '', min_increment: listing.min_increment, starting_bid: listing.starting_bid,
          reserve: listing.reserve, seller_coco_payment_public_key: listing.seller_coco_payment_public_key };
        view.state.height = 2;
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ height: 2 }) };
      }
      const data = url.startsWith('/api/state')
        ? (staleStateReads > 0 ? (staleStateReads -= 1, staleView) : view)
        : url === '/api/validators' ? { validators: [] }
        : url === '/api/browser-release-pins' ? pins : config;
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(data) };
    },
    setInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
    Date: class extends Date { static now() { return now; } }, AbortController, structuredClone, console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/ui-helpers.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8'), context);
  const run = source => vm.runInContext(source, context);
  await settle(); await run('connect()'); await settle();
  return { calls, get, run, view };
}

test('seller approval controls and service loop are absent from the shipped UI', () => {
  const html = fs.readFileSync(path.join(__dirname, 'static/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8');
  for (const removed of ['Enable bid-plan approvals for this auction', 'Stop bid-plan approvals',
    'stop-seller-approvals', 'seller-approval-status', 'serviceSellerApprovals']) {
    assert.equal(html.includes(removed), false, `${removed} remains in index.html`);
    assert.equal(app.includes(removed), false, `${removed} remains in app.js`);
  }
  assert.match(html, /New auctions register one bounded payout authorization/);
  assert.match(html, /Import available returns & payouts/);
});

test('auction creation registers one exact auction-scoped authorization and never services seller plans', async () => {
  const held = await fixture();
  held.get('title').value = 'Offline seller listing'; held.get('description').value = 'test';
  held.get('image').value = ''; held.get('duration').value = '600'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.equal(held.calls.authorizations.length, 1);
  assert.equal(held.calls.sellerPlans, 0);
  const authorization = held.calls.authorizations[0];
  assert.equal(authorization.startingBid, 100); assert.equal(authorization.minIncrement, 100);
  assert.equal(authorization.reserve, 0); assert.equal(authorization.maximumPayout, 50000);
  assert.equal(authorization.maximumEndTime, authorization.originalEndTime + 1800);
  assert.equal(authorization.validUntil, authorization.maximumEndTime + 900);
  assert.match(held.get('message').textContent, /covers bids while the seller is offline/);
});

test('auction creation waits through one stale post-commit state read before authorizing payout', async () => {
  const held = await fixture({ staleStateReadsAfterCreate: 1 });
  held.get('title').value = 'Stale read recovery'; held.get('description').value = 'test';
  held.get('image').value = ''; held.get('duration').value = '600'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.equal(held.calls.authorizations.length, 1);
  assert.match(held.get('message').textContent, /covers bids while the seller is offline/);
  assert.doesNotMatch(held.get('message').textContent, /differs from the signed listing/);
});

test('a bidder submits the funded bid without invoking any per-bid seller approval service', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  assert.ok(input); assert.ok(button);
  input.value = '600'; input.oninput(); await button.onclick(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.bids[0].auctionId, 'a1');
  assert.equal(held.calls.bids[0].bidAmount, 600); assert.equal(held.calls.sellerPlans, 0);
  assert.match(held.get('message').textContent, /Threshold bid admitted at height 3/);
});

test('manual payment button imports returns and payouts only', async () => {
  const held = await fixture(); const before = held.calls.imports;
  const button = held.get('process-payments');
  await button.onclick({ currentTarget: button }); await settle();
  assert.ok(held.calls.imports > before); assert.equal(held.calls.sellerPlans, 0);
});

test('background refresh throttles wallet maintenance while manual import bypasses the interval', async () => {
  const held = await fixture(); const before = held.calls.imports;
  await held.run('refresh()'); await held.run('refresh()'); await settle();
  assert.equal(held.calls.imports, before);
  const button = held.get('process-payments');
  await button.onclick({ currentTarget: button }); await settle();
  assert.equal(held.calls.imports, before + 1);
});

test('legacy auction missing an offline authorization fails pre-lock without asking for a seller tab', async () => {
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'seller_plan_pending' });
  await held.run('placeBid("a1", 600)'); await settle();
  assert.equal(held.calls.sellerPlans, 0);
  assert.match(held.get('message').textContent, /no registered offline payout authorization/);
  assert.doesNotMatch(held.get('message').textContent, /seller tab|service its plans/i);
});

test('failed auction authorization is visible and offers one scoped setup retry, not per-bid approval', async () => {
  const held = await fixture({ rejectAuthorization: true });
  held.get('title').value = 'Rejected authorization'; held.get('description').value = '';
  held.get('image').value = ''; held.get('duration').value = '600'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.authorizations.length, 1); assert.equal(held.calls.sellerPlans, 0);
  assert.match(held.get('message').textContent, /authorization denied/);
  assert.doesNotMatch(held.get('message').textContent, /covers bids while the seller is offline/);
  const retry = findNode(held.get('auctions'), node => node?.textContent === 'Complete offline bidding setup');
  assert.ok(retry); held.calls.rejectAuthorization = false;
  await retry.onclick(); await settle();
  assert.equal(held.calls.authorizations.length, 2); assert.equal(held.calls.sellerPlans, 0);
  assert.match(held.get('message').textContent, /bidders no longer need this seller tab/);
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Complete offline bidding setup'), undefined);
});
