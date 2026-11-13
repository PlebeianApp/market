const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element extends EventTarget {
  static activeElement = null;
  constructor(tag = 'div') {
    super();
    this.tagName = tag; this.children = []; this.textContent = ''; this.dataset = {};
    this.value = ''; this.disabled = false; this.validationMessage = ''; this.isConnected = false;
    this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = 'none';
  }
  setConnected(value) {
    this.isConnected = value;
    for (const child of this.children) child?.setConnected?.(value);
    if (!value && Element.activeElement === this) Element.activeElement = null;
  }
  append(...nodes) { this.children.push(...nodes); for (const node of nodes) node?.setConnected?.(this.isConnected); }
  replaceChildren(...nodes) {
    for (const node of this.children) node?.setConnected?.(false);
    this.children = nodes;
    for (const node of nodes) node?.setConnected?.(this.isConnected);
  }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
  setCustomValidity(value) { this.validationMessage = value; }
  focus() { Element.activeElement = this; }
  setSelectionRange(start, end, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  click() {
    if (this.disabled || !this.isConnected) return undefined;
    const event = new Event('click'); super.dispatchEvent(event);
    return this.onclick?.(event);
  }
  get lastChild() { return this.children.at(-1); }
  reset() {}
}

const actor = 'aa'.repeat(32), otherActor = 'bb'.repeat(32);
const pause = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i += 1) await pause(); }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function pointerGesture(target, between) {
  assert.equal(target.disabled, false); assert.equal(target.isConnected, true);
  target.dispatchEvent(new Event('pointerdown'));
  await between();
  target.dispatchEvent(new Event('pointerup'));
  if (!target.isConnected || target.disabled) return undefined;
  return target.click();
}
function findNode(node, accept) {
  if (accept(node)) return node;
  return (node?.children || []).map(child => findNode(child, accept)).find(Boolean);
}
function findNodes(node, accept, matches = []) {
  if (accept(node)) matches.push(node);
  for (const child of node?.children || []) findNodes(child, accept, matches);
  return matches;
}

async function fixture({ auctionSeller = actor, bidStatus = 'admitted', rejectAuthorization = false,
  staleStateReadsAfterCreate = 0, eventResponseLossAfterCommit = 0, maxDurationSeconds = 3600,
  eventTransportFailuresBeforeCommit = 0, eventExpiredRejections = 0,
  validatorFailure = false, balanceFailure = false, stateFailure = false, stateHang = false,
  recoveredBidAmount, bidGate = null, bidPhases = [], bidPhaseGate = null, enableAckRepair = false,
  commitBeforeResumeResult = false, committedResumeAmount = null, duplicateCommittedResume = false,
  profileReader = async () => null } = {}) {
  Element.activeElement = null;
  const intervals = [];
  const storage = new Map();
  const nodes = new Map(), get = id => {
    if (!nodes.has(id)) { const node = new Element(); node.setConnected(true); nodes.set(id, node); }
    return nodes.get(id);
  };
  let now = 1800000000000, timeoutSequence = 0;
  const timeouts = new Map();
  let nextStateReadGate = null, nextValidatorReadGate = null, nextImportGate = null, concurrentImports = 0;
  const calls = { imports: 0, sellerPlans: 0, listingSigns: 0, signedListings: [], authorizations: [], bids: [], resumes: [], repairs: [], ackRepairs: [],
    eventPosts: [], importedWinnerAuctionIds: [], importedRefundOperationIds: [], importFailures: 0, maxConcurrentImports: 0,
    bidFailures: 0, repairFailures: 0, ackRepairFailures: 0, payoutStatus: null, returnStatus: null, rejectAuthorization,
    bidProgress: [], profileReads: [] };
  const registeredPayouts = new Set();
  const importedPayouts = new Set();
  const importedReturns = new Set();
  if (auctionSeller === actor) registeredPayouts.add('a1');
  const auction = { id: 'a1', seller: auctionSeller, status: 'open', title: 'a1', created_at: 1,
    end_time: 1900000000, original_end_time: 1900000000, high_bid: 0, leader_bid_id: '',
    min_increment: 100, starting_bid: 100, reserve: 0 };
  const view = { state: { auctions: { a1: auction }, bids: {}, height: 1, last_consensus_time: 1800000000 } };
  let staleView = null, staleStateReads = 0;
  let controllerActor = actor;
  const controller = {
    async actor() { return controllerActor; },
    async pendingFakeFunding() { return null; },
    async sellerPaymentPublicKey() { return '02' + 'cc'.repeat(32); },
    async readAuctionPayout(auctionId) {
      return registeredPayouts.has(auctionId) ? { authorization: { auctionId } } : null;
    },
    async readAuctionPayoutImportStatus(auctionId) {
      return importedPayouts.has(auctionId) ? 'settled' : calls.payoutStatus;
    },
    async readBidReturnImportStatus(operationId) {
      return importedReturns.has(operationId) || calls.importedRefundOperationIds.includes(operationId) ? 'settled' : (calls.returnStatus || 'pending');
    },
    async repairAuctionPayoutDiscovery(auctionId) {
      calls.repairs.push(auctionId);
      if (calls.repairFailures > 0) { calls.repairFailures -= 1; throw new Error('seller discovery unavailable'); }
      return registeredPayouts.has(auctionId) ? 'retained' : 'missing';
    },
    async authorizeAuctionPayout(value) {
      calls.authorizations.push(structuredClone(value));
      if (calls.rejectAuthorization) throw new Error('authorization denied');
      registeredPayouts.add(value.auctionId);
      return { authorizationDigest: 'dd'.repeat(32) };
    },
    async placeBid(value, observe) {
      calls.bids.push(structuredClone(value));
      for (const phase of bidPhases) {
        calls.bidProgress.push(phase); observe?.({ phase });
        if (bidPhaseGate?.phase === phase) await bidPhaseGate.gate.promise;
      }
      if (bidGate) await bidGate.promise;
      if (calls.bidFailures > 0) { calls.bidFailures -= 1; throw new Error('transient bid callback failed'); }
      if (bidStatus === 'resume_required' && commitBeforeResumeResult) {
        view.state.bids.committed = { id: 'committed', auction_id: value.auctionId, bidder: actor,
          amount: committedResumeAmount ?? value.bidAmount, committed_at: 2, integrated_funding_id: 'bid-operation' };
        if (duplicateCommittedResume) {
          view.state.bids.duplicate = { id: 'duplicate', auction_id: value.auctionId, bidder: actor,
            amount: value.bidAmount + 1, committed_at: 3, integrated_funding_id: 'bid-operation' };
        }
        view.state.auctions[value.auctionId].leader_bid_id = 'committed';
        view.state.auctions[value.auctionId].high_bid = value.bidAmount;
        view.state.height = 3;
      }
      return bidStatus === 'seller_plan_pending'
        ? { status: bidStatus, fundingOperationId: 'legacy-prelock-operation' }
        : bidStatus === 'resume_required'
        ? { status: bidStatus, fundingOperationId: 'bid-operation', retainedBidAmount: 600, recoveryStage: 'funds_locked' }
        : { status: bidStatus, fundingOperationId: 'bid-operation', committedHeight: 3,
          ...(recoveredBidAmount === undefined ? {} : { recoveredBidAmount }) };
    },
    async retainedBidRecoveries() {
      return bidStatus === 'resume_required' && calls.bids.length > 0 && calls.resumes.length === 0
        ? [{ auctionId: 'a1', fundingOperationId: 'bid-operation', retainedBidAmount: 600, recoveryStage: 'funds_locked' }]
        : [];
    },
    async resumeBid(fundingOperationId, observe) {
      calls.resumes.push(fundingOperationId);
      observe?.({ phase: 'resuming_exact' });
      return { status: 'admitted', fundingOperationId, committedHeight: 4, retainedBidAmount: 600 };
    },
    async importAvailable() {
      calls.imports += 1; concurrentImports += 1; calls.maxConcurrentImports = Math.max(calls.maxConcurrentImports, concurrentImports);
      try {
        if (nextImportGate) { const gate = nextImportGate; nextImportGate = null; await gate.promise; }
        if (calls.importFailures > 0) { calls.importFailures -= 1; throw new Error('terminal transport unavailable'); }
        const winnerAuctionIds = calls.importedWinnerAuctionIds.splice(0);
        const refundOperationIds = calls.importedRefundOperationIds.splice(0);
        for (const auctionId of winnerAuctionIds) importedPayouts.add(auctionId);
        for (const operationId of refundOperationIds) importedReturns.add(operationId);
        return { refunds: refundOperationIds.length, winnerPayments: winnerAuctionIds.length, winnerAuctionIds, refundOperationIds };
      } finally { concurrentImports -= 1; }
    },
    async balance() { if (balanceFailure) throw new Error('wallet unavailable'); return { available: 1000, reserved: 0, locked: 0, pending: 0, unresolved: 0 }; },
    async expiredPrelockPending() { return []; },
    async serviceSellerPlans() { calls.sellerPlans += 1; throw new Error('legacy per-bid seller service must not run'); },
  };
  if (enableAckRepair) controller.repairBidReturnAcknowledgement = async operationId => {
    calls.ackRepairs.push(operationId);
    if (calls.ackRepairFailures > 0) { calls.ackRepairFailures -= 1; throw new Error('terminal acknowledgement unavailable'); }
    if (calls.returnStatus !== 'wallet_imported_ack_pending') return 'not_applicable';
    calls.returnStatus = 'settled'; importedReturns.add(operationId); return 'settled';
  };
  const pins = { schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V2', deployment_id: 'deployment-one', auth_network_id: 'chain', chain_id: 'chain',
    genesis_sha256: 'a'.repeat(64), validators_hash: 'e'.repeat(64), cashu_mint_url: 'https://mint.example', committee_keyset_id: 'keyset', committee_keyset_version: '1',
    dkg_run_id: 'dkg', committee_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    public_key_package_sha256: 'b'.repeat(64), signer_roster_digest: 'c'.repeat(64), fake_funding_policy_digest: 'd'.repeat(64),
    auction_policy_digest: '257fb5bf2b414f206278ada15464030a075d6f4f51b9c2f6b965259136f9a777',
    auction_payment_policy_digest: '4d88017e3d191421aa46702ca9b6670fb324162c4c39d3ce4604bbfcfec3492b' };
  const config = { ...pins, fake_funding_policy: { digest: pins.fake_funding_policy_digest },
    auction_payment_policy: { schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYMENT_POLICY_V1', max_bid_amount: 50000, max_payout: 50000 },
    auction_policy: { schema: 'PLEBEIAN_AUCTION_TIMING_POLICY_V1', min_duration_seconds: 3, max_duration_seconds: maxDurationSeconds,
      default_duration_seconds: 600, late_bid_window_seconds: 180, late_bid_extension_seconds: 180,
      max_total_extension_seconds: 1800, emergency_recovery_seconds: 900 }, threshold_custody: true,
    browser_threshold_wallet_ready: true, browser_threshold_admission_ready: true, recovery_only: false };
  const signer = { async getPublicKey() { return actor; }, async signEvent(value) {
    calls.listingSigns += 1; calls.signedListings.push(structuredClone(value));
    return { ...structuredClone(value), pubkey: actor, id: 'ee'.repeat(32), sig: 'ff'.repeat(64) };
  } };
  const document = { body: new Element('body'), getElementById: get, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) };
  document.body.setConnected(true);
  Object.defineProperty(document, 'activeElement', { get: () => Element.activeElement });
  const context = vm.createContext({
    window: { nostr: signer, plebeianFridayR20Connect: async ({ signer: connectedSigner }) => {
      controllerActor = await connectedSigner.getPublicKey(); return controller;
    }, confirm: () => true,
      plebeianReadNostrProfile: async (requestedActor, options) => {
        calls.profileReads.push(requestedActor); return profileReader(requestedActor, options);
      } }, document,
    fetch: async (url, init) => {
      if (url.startsWith('/api/state') && nextStateReadGate) { const gate = nextStateReadGate; nextStateReadGate = null; await gate.promise; }
      if (url.startsWith('/api/state') && stateFailure) throw new Error('committed state unavailable');
      if (url.startsWith('/api/state') && stateHang) return {
        ok: true, headers: { get: () => 'application/json' },
        json: () => new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new Error('state body aborted'));
          else init?.signal?.addEventListener('abort', () => reject(new Error('state body aborted')), { once: true });
        }),
      };
      if (url === '/api/validators' && nextValidatorReadGate) { const gate = nextValidatorReadGate; nextValidatorReadGate = null; await gate.promise; }
      if (url === '/api/validators' && validatorFailure) throw new Error('validator evidence unavailable');
      if (url === '/api/event') {
        const signed = JSON.parse(init.body), listing = JSON.parse(signed.content);
        calls.eventPosts.push(signed.id);
        if (eventTransportFailuresBeforeCommit > 0) { eventTransportFailuresBeforeCommit -= 1; throw new Error('consensus outcome unavailable'); }
        if (eventExpiredRejections > 0) {
          eventExpiredRejections -= 1;
          return { ok: false, status: 422, headers: { get: () => 'application/json' },
            json: async () => ({ error: 'CheckTx rejected: signed event is outside the consensus-time window' }) };
        }
        staleView = structuredClone(view); staleStateReads = staleStateReadsAfterCreate;
        const committedAt = Math.floor(now / 1000);
        view.state.auctions[listing.auction_id] = { id: listing.auction_id, seller: actor, status: 'open', title: listing.title,
          description: listing.description, image_url: listing.image_url, created_at: committedAt,
          original_end_time: committedAt + listing.duration_seconds, end_time: committedAt + listing.duration_seconds,
          high_bid: 0, leader_bid_id: '', min_increment: listing.min_increment, starting_bid: listing.starting_bid,
          reserve: listing.reserve, seller_coco_payment_public_key: listing.seller_coco_payment_public_key };
        view.state.height = 2;
        if (eventResponseLossAfterCommit > 0) { eventResponseLossAfterCommit -= 1; throw new Error('response lost after commit'); }
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ height: 2 }) };
      }
      const data = url.startsWith('/api/state')
        ? (staleStateReads > 0 ? (staleStateReads -= 1, staleView) : view)
        : url === '/api/validators' ? { validators: [] }
        : url === '/api/browser-release-pins' ? pins : config;
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(data) };
    },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key) },
    setInterval(run, ms) {
      const interval = { ms, active: true, run() { if (interval.active) run(); } };
      intervals.push(interval); return interval;
    },
    clearInterval(interval) { if (interval) interval.active = false; },
    setTimeout(run) { timeoutSequence += 1; timeouts.set(timeoutSequence, run); return timeoutSequence; },
    clearTimeout(id) { timeouts.delete(id); },
    Date: class extends Date { static now() { return now; } }, AbortController, URL, structuredClone, console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/ui-helpers.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8'), context);
  const run = source => vm.runInContext(source, context);
  await settle(); await run('connect()'); await settle();
  return { calls, controller, get, run, view, intervals, document, advance(milliseconds) { now += milliseconds; },
    readiness(value) { config.browser_threshold_wallet_ready = value; config.browser_threshold_admission_ready = value; },
    failState(value) { stateFailure = value; }, hangState(value) { stateHang = value; }, failBalance(value) { balanceFailure = value; },
    fireTimeouts() { const pending = [...timeouts.values()]; timeouts.clear(); for (const runTimeout of pending) runTimeout(); },
    gateNextStateRead(gate) { nextStateReadGate = gate; }, gateNextValidatorRead(gate) { nextValidatorReadGate = gate; },
    gateNextImport(gate) { nextImportGate = gate; } };
}

test('seller approval controls and service loop are absent from the shipped UI', () => {
  const html = fs.readFileSync(path.join(__dirname, 'static/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8');
  for (const removed of ['Enable bid-plan approvals for this auction', 'Stop bid-plan approvals',
    'stop-seller-approvals', 'seller-approval-status', 'serviceSellerApprovals']) {
    assert.equal(html.includes(removed), false, `${removed} remains in index.html`);
    assert.equal(app.includes(removed), false, `${removed} remains in app.js`);
  }
  assert.match(html, /Returns and seller payouts settle automatically/);
  assert.equal((html.match(/id="process-payments"/g) || []).length, 1);
  assert.doesNotMatch(html, /Review expired bid intents|Import available returns (?:&|&amp;) payouts/);
});

test('mobile signer UI protects pairing credentials and explains browser-local wallet ownership', () => {
  const html = fs.readFileSync(path.join(__dirname, 'static/index.html'), 'utf8');
  assert.match(html, /id="nip46-code"[^>]*type="password"[^>]*autocomplete="off"/);
  assert.match(html, /id="dev-nsec"[^>]*type="password"[^>]*autocomplete="off"/);
  assert.match(html, /Wallet stays in this browser|wallet stays in this browser/i);
  assert.match(html, /does not move or sync Coco wallet funds/i);
  assert.match(html, /DEVELOPMENT \/ TESTING ONLY/);
  assert.match(html, /Never paste a main or valuable Nostr key here/);
  assert.match(html, /dev-nsec-open[^>]*hidden/);
  const signerSource = fs.readFileSync(path.join(__dirname, '../../cashu-wrapper/ts/poc-nostr-signers.ts'), 'utf8');
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'console.log', 'console.warn', 'location.search']) {
    assert.equal(signerSource.includes(forbidden), false, `signer source must not use ${forbidden}`);
  }
});

test('development nsec is hidden by default, opt-in only, cleared immediately, and disposed on disconnect', async () => {
  const held = await fixture();
  held.run('disconnect(); updateControls()');
  assert.equal(held.get('dev-nsec-open').hidden, true);
  held.run('state.config.dev_nsec_signer_enabled = true; updateControls()');
  assert.equal(held.get('dev-nsec-open').hidden, false);
  held.get('dev-nsec').value = 'nsec1must-never-be-retained';
  const connected = held.run(`(() => {
    window.devNsecInput = ""; window.devNsecClosed = 0;
    window.plebeianCreateDevNsecSigner = value => {
      window.devNsecInput = value;
      return { getPublicKey: async () => '${actor}', signEvent: async value => ({ ...value, pubkey: '${actor}', id: '${'ee'.repeat(32)}', sig: '${'ff'.repeat(64)}' }),
        close: async () => { window.devNsecClosed += 1; } };
    };
    return connectDevNsec();
  })()`);
  assert.equal(held.get('dev-nsec').value, '');
  await connected; await settle();
  assert.equal(held.run('window.devNsecInput'), 'nsec1must-never-be-retained');
  assert.equal(held.run('state.identityMode'), 'DEV nsec · memory only');
  held.run('disconnect()'); await settle();
  assert.equal(held.run('window.devNsecClosed'), 1);
  assert.equal(held.run('state.signer'), null);
});

test('cancelled Clave pairing clears the code and fences a late signer response', async () => {
  const held = await fixture();
  held.run('disconnect(); window.claveClosed = 0; window.claveResolve = null; window.plebeianCreateClaveNip46Signer = () => new Promise(resolve => { window.claveResolve = resolve; });');
  held.get('nip46-code').value = 'bunker://secret-must-not-remain';
  const pairing = held.run('connectClave()');
  assert.equal(held.get('nip46-code').value, '');
  await settle();
  assert.match(held.get('nip46-status').textContent, /foreground/i);
  assert.match(held.get('nip46-status').textContent, /do not switch apps/i);
  held.run('cancelClavePairing(); window.claveResolve({ getPublicKey: async () => "' + otherActor + '", signEvent: async value => value, close: async () => { window.claveClosed += 1; } });');
  await assert.rejects(pairing, /cancelled/); await settle();
  assert.equal(held.run('window.claveClosed'), 1);
  assert.equal(held.run('state.actor'), '');
  assert.equal(held.run('state.friday'), null);
  assert.match(held.get('nip46-status').textContent, /cancelled/i);
});

test('connected Clave signer is scoped to its account generation and closed on release identity invalidation', async () => {
  const held = await fixture();
  held.run(`disconnect(); window.claveClosed = 0; window.plebeianCreateClaveNip46Signer = async () => ({
    getPublicKey: async () => '${actor}',
    signEvent: async value => ({ ...value, pubkey: '${actor}', id: '${'ee'.repeat(32)}', sig: '${'ff'.repeat(64)}' }),
    close: async () => { window.claveClosed += 1; },
  });`);
  held.get('nip46-code').value = 'bunker://redacted-test-code';
  await held.run('connectClave()'); await settle();
  assert.equal(held.get('nip46-code').value, '');
  assert.equal(held.run('state.actor'), actor);
  assert.equal(held.run('state.identityMode'), 'Clave · NIP-46');
  assert.match(held.get('message').textContent, /Wallet funds remain browser-local/i);
  held.run('invalidateReadinessIdentity()'); await settle();
  assert.equal(held.run('window.claveClosed'), 1);
  assert.equal(held.run('state.signer'), null);
  assert.equal(held.run('state.actor'), '');
});

test('dashboard renders bounded signed-profile presentation as text and keeps badge trust unavailable', async () => {
  const maliciousName = '<img src=x onerror=steal()> Alice';
  const held = await fixture({ profileReader: async requestedActor => ({
    actor: requestedActor, eventId: '12'.repeat(32), createdAt: 10,
    displayName: maliciousName, name: '', about: '', picture: 'https://images.example/avatar.png', nip05: 'alice@example.com',
  }) });
  await settle();
  assert.equal(held.get('account-dashboard').hidden, false);
  assert.equal(held.get('profile-name').textContent, maliciousName);
  assert.equal(held.get('header-profile-name').textContent, maliciousName);
  assert.match(held.get('profile-metadata-note').textContent, /self-claimed/);
  assert.equal(held.get('profile-key').textContent, 'aaaaaaaa…aaaaaa');
  assert.equal(held.get('profile-avatar').src, 'https://images.example/avatar.png');
  assert.equal(held.get('profile-avatar').hidden, true, 'remote image stays behind the fallback until load succeeds');
  held.get('profile-avatar').onerror();
  assert.equal(held.get('profile-avatar').hidden, true);
  assert.equal(held.get('profile-avatar-fallback').hidden, false);
  assert.equal(held.get('plebeian-badge').dataset.state, 'unavailable', 'metadata never upgrades an unconfigured badge');
  assert.equal(held.document.body.dataset.identity, 'connected');
  assert.equal(held.calls.profileReads.length, 1);
});

test('disconnect aborts and fences a late profile response from the retired identity', async () => {
  const gate = deferred(); let observedSignal;
  const held = await fixture({ profileReader: async (_requestedActor, options) => {
    observedSignal = options.signal; return gate.promise;
  } });
  await settle();
  assert.equal(held.run('state.profilePhase'), 'loading');
  held.run('disconnect(); render()');
  assert.equal(observedSignal.aborted, true);
  gate.resolve({ actor, eventId: '34'.repeat(32), createdAt: 11, displayName: 'Stale Alice', name: '', about: '', picture: '', nip05: '' });
  await settle();
  assert.equal(held.run('state.profile'), null);
  assert.equal(held.get('account-dashboard').hidden, true);
  assert.equal(held.get('header-profile-name').textContent, 'Account');
  assert.equal(held.document.body.dataset.identity, 'disconnected');
});

test('account replacement aborts the old profile read and cannot overwrite the new actor', async () => {
  const first = deferred(); let oldSignal;
  const held = await fixture({ profileReader: async (requestedActor, options) => {
    if (requestedActor === actor) { oldSignal = options.signal; return first.promise; }
    return { actor: requestedActor, eventId: '56'.repeat(32), createdAt: 12,
      displayName: 'New account', name: '', about: '', picture: '', nip05: '' };
  } });
  await settle();
  await held.run(`installSigner({
    getPublicKey: async () => '${otherActor}',
    signEvent: async value => ({ ...value, pubkey: '${otherActor}', id: '${'ab'.repeat(32)}', sig: '${'cd'.repeat(64)}' }),
    close: async () => undefined,
  }, 'NIP-07')`);
  await settle();
  assert.equal(oldSignal.aborted, true);
  assert.equal(held.run('state.actor'), otherActor);
  assert.equal(held.get('profile-name').textContent, 'New account');
  first.resolve({ actor, eventId: '78'.repeat(32), createdAt: 13, displayName: 'Retired account', name: '', about: '', picture: '', nip05: '' });
  await settle();
  assert.equal(held.run('state.actor'), otherActor);
  assert.equal(held.get('profile-name').textContent, 'New account');
});

test('a profile lookup failure leaves signing, balance and payment recovery available', async () => {
  const held = await fixture({ profileReader: async () => { throw new Error('profile relay unavailable'); } });
  await settle();
  assert.equal(held.run('state.profilePhase'), 'unavailable');
  assert.equal(held.get('profile-name').textContent, 'Connected bidder');
  assert.match(held.get('profile-metadata-note').textContent, /profile unavailable/i);
  assert.equal(held.run('state.actor'), actor);
  assert.ok(held.run('state.friday'));
  assert.equal(held.get('faucet').disabled, false);
  assert.equal(held.get('spendable').textContent, '1,000');
});

test('validator or wallet read failures do not mislabel the committed catalogue', async () => {
  const validator = await fixture({ validatorFailure: true });
  assert.ok(findNode(validator.get('auctions'), node => node?.textContent === 'a1'));
  assert.match(validator.get('market-meta').textContent, /1 live/);
  assert.match(validator.get('validator-summary').textContent, /observations unavailable/);
  const wallet = await fixture({ balanceFailure: true });
  assert.ok(findNode(wallet.get('auctions'), node => node?.textContent === 'a1'));
  assert.match(wallet.get('market-meta').textContent, /1 live/);
  assert.ok(findNode(wallet.get('notes'), node => node?.textContent === 'Wallet state unavailable'));
});

test('closed history is hidden by default, discoverable on request, and leaves a clear live empty state', async () => {
  const held = await fixture();
  held.run(`state.view.state.auctions.a1.status = 'closed'; state.view.state.auctions.a1.winner = ''; renderAuctions()`);
  assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1'), undefined);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'No live auctions right now'));
  const toggle = held.get('auction-history-toggle');
  assert.equal(toggle.hidden, false); assert.equal(toggle.textContent, 'Show past auctions (1)');
  toggle.onclick();
  assert.ok(findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1'));
  assert.equal(toggle.textContent, 'Hide past auctions'); assert.equal(toggle['aria-expanded'], 'true');
});

test('closed auctions remain visible only while this identity has refund, payout, or settlement work', async () => {
  const refund = await fixture({ auctionSeller: otherActor });
  refund.run(`state.view.state.auctions.a1.status = 'closed'; state.view.state.auctions.a1.winner = '${otherActor}';
    state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 600, committed_at: 2, integrated_funding_id: 'return-one' };
    renderAuctions()`);
  assert.ok(findNode(refund.get('auctions'), node => node?.dataset?.auctionId === 'a1'));
  assert.ok(findNode(refund.get('auctions'), node => node?.textContent === 'Auction ended · return scheduled'));
  refund.run(`state.importedReturnOperations.add('return-one'); renderAuctions()`);
  assert.equal(findNode(refund.get('auctions'), node => node?.dataset?.auctionId === 'a1'), undefined);
  assert.equal(refund.get('auction-history-toggle').textContent, 'Show past auctions (1)');

  const payout = await fixture();
  payout.run(`state.view.state.auctions.a1.status = 'closed'; state.view.state.auctions.a1.winner = '${otherActor}'; renderAuctions()`);
  assert.ok(findNode(payout.get('auctions'), node => node?.dataset?.auctionId === 'a1'));
  assert.ok(findNode(payout.get('auctions'), node => node?.textContent === 'Seller payout pending'));
  payout.run(`state.importedAuctionPayouts.add('a1'); renderAuctions()`);
  assert.equal(findNode(payout.get('auctions'), node => node?.dataset?.auctionId === 'a1'), undefined);
  assert.equal(payout.get('auction-history-toggle').textContent, 'Show past auctions (1)');
});

test('a committed winner is history rather than bidder recovery and shows a committed close', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.auctions.a1.status = 'closed'; state.view.state.auctions.a1.winner = '${actor}';
    state.view.state.auctions.a1.leader_bid_id = 'mine';
    state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 250,
      committed_at: 2, integrated_funding_id: 'winner-operation' };
    renderAuctions()`);
  assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1'), undefined);
  assert.equal(held.get('auction-history-toggle').textContent, 'Show past auctions (1)');
  assert.doesNotMatch(held.get('market-meta').textContent, /need your attention/);
  held.get('auction-history-toggle').onclick();
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'You won'));
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Closed · committed'));
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Ended · awaiting committed close'), undefined);
});

test('auction creation registers one exact auction-scoped authorization and never services seller plans', async () => {
  const held = await fixture();
  held.get('title').value = 'Offline seller listing'; held.get('description').value = 'test';
  held.get('image').value = ''; held.get('duration').value = '10'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.equal(held.calls.authorizations.length, 1);
  assert.equal(held.calls.sellerPlans, 0);
  assert.equal(JSON.parse(held.calls.signedListings[0].content).duration_seconds, 600);
  const authorization = held.calls.authorizations[0];
  assert.equal(authorization.startingBid, 100); assert.equal(authorization.minIncrement, 100);
  assert.equal(authorization.reserve, 0); assert.equal(authorization.maximumPayout, 50000);
  assert.equal(authorization.maximumEndTime, authorization.originalEndTime + 1800);
  assert.equal(authorization.validUntil, authorization.maximumEndTime + 900);
  assert.match(held.get('message').textContent, /covers bids while the seller is offline/);
});

test('seven-day backend profile stays inactive without a matching approved release identity', async () => {
  const held = await fixture({ maxDurationSeconds: 604800 });
  held.get('title').value = 'Seven-day listing'; held.get('description').value = 'long listing';
  held.get('image').value = ''; held.get('duration-unit').value = 'days'; held.get('duration').value = '7';
  held.get('starting').value = '100'; held.get('increment').value = '100'; held.get('reserve').value = '0';
  assert.equal(held.get('create-submit').disabled, true);
  assert.equal(held.get('duration-7d').disabled, true);
  held.get('duration-7d').onclick();
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.signedListings.length, 0); assert.equal(held.calls.authorizations.length, 0);
  assert.match(held.get('message').textContent, /reviewed one-hour auction and payment policies are not bound/);
});

test('legacy one-hour backend keeps demo shortcuts but disables longer UI choices', async () => {
  const held = await fixture({ maxDurationSeconds: 3600 });
  assert.equal(held.get('duration-10m').disabled, false); assert.equal(held.get('duration-30m').disabled, false);
  assert.equal(held.get('duration-1d').disabled, true); assert.equal(held.get('duration-7d').disabled, true);
  assert.match(held.get('duration-help').textContent, /keep at least 3 minutes remaining/);
  assert.doesNotMatch(held.get('duration-help').textContent, /extend by 3 minutes/);
  held.get('duration-7d').onclick();
  assert.equal(held.get('duration').value, ''); assert.equal(held.get('duration-unit').value, 'minutes');
});

test('auction creation waits through one stale post-commit state read before authorizing payout', async () => {
  const held = await fixture({ staleStateReadsAfterCreate: 1 });
  held.get('title').value = 'Stale read recovery'; held.get('description').value = 'test';
  held.get('image').value = ''; held.get('duration').value = '10'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.equal(held.calls.authorizations.length, 1);
  assert.match(held.get('message').textContent, /covers bids while the seller is offline/);
  assert.doesNotMatch(held.get('message').textContent, /differs from the signed listing/);
});

test('lost listing response recovers the same retained event without a second signature or post', async () => {
  const held = await fixture({ eventResponseLossAfterCommit: 1 });
  held.get('title').value = 'Response-loss listing'; held.get('description').value = 'test';
  held.get('image').value = ''; held.get('duration').value = '10'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.equal(held.calls.eventPosts.length, 1);
  assert.equal(held.calls.authorizations.length, 0); assert.match(held.get('message').textContent, /response lost/);
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.equal(held.calls.eventPosts.length, 1);
  assert.equal(held.calls.authorizations.length, 1);
  assert.match(held.get('message').textContent, /covers bids while the seller is offline/);
});

test('a definitively expired uncommitted listing clears its recovery fence before a fresh signature', async () => {
  const held = await fixture({ eventTransportFailuresBeforeCommit: 1, eventExpiredRejections: 1 });
  held.get('title').value = 'Expired listing retry'; held.get('description').value = 'test';
  held.get('image').value = ''; held.get('duration').value = '10'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.match(held.get('message').textContent, /outcome unavailable/);
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 1); assert.match(held.get('message').textContent, /definitively rejected as expired/);
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 2); assert.equal(held.calls.authorizations.length, 1);
  assert.match(held.get('message').textContent, /covers bids while the seller is offline/);
});

test('a bidder submits the funded bid without invoking any per-bid seller approval service', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  assert.ok(input); assert.ok(button);
  input.value = '600'; input.oninput(); await button.onclick(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.bids[0].auctionId, 'a1');
  assert.equal(held.calls.bids[0].bidAmount, 600); assert.equal(held.calls.sellerPlans, 0);
  assert.match(held.get('message').textContent, /Bid committed at height 3/);
});

test('pointer-down, countdown tick, and pointer-up submit exactly one bid without replacing Catalogue controls', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); input.focus(); input.setSelectionRange(1, 2, 'forward');
  const tick = held.intervals.find(interval => interval.ms === 1000); assert.ok(tick);
  await pointerGesture(button, async () => {
    tick.run();
    assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1'), input);
    assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid'), button);
    assert.equal(held.document.activeElement, input); assert.equal(input.value, '600');
    assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [1, 2, 'forward']);
  });
  await settle(); assert.equal(held.calls.bids.length, 1);
});

test('pointer gesture spanning an unchanged four-second refresh keeps the same bid nodes and submits once', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); input.focus(); input.setSelectionRange(2, 3);
  await pointerGesture(button, async () => {
    await held.run('refresh()'); await settle();
    assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1'), input);
    assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid'), button);
    assert.equal(held.document.activeElement, input); assert.equal(input.value, '600');
    assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 3]);
  });
  await settle(); assert.equal(held.calls.bids.length, 1);
});

test('expanded lot details survive a changed committed-state rerender', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  let details = findNode(held.get('auctions'), node => node?.tagName === 'details' && node?.className === 'auction-details');
  assert.ok(details); details.open = true; details.ontoggle(); details.children[0].focus();
  held.run('state.view.state.auctions.a1.high_bid = 200; renderAuctions()');
  details = findNode(held.get('auctions'), node => node?.tagName === 'details' && node?.className === 'auction-details');
  assert.equal(details.open, true);
  assert.equal(held.document.activeElement, details.children[0]);
});

test('validator technical details preserve expansion and keyboard focus across snapshot refresh', async () => {
  const held = await fixture(), blockHash = 'AB'.repeat(32);
  held.run(`state.validatorPhase = 'ready'; state.validators = { observed_at: '2026-11-12T00:00:00Z', validators: [
    { slot: 1, moniker: 'Validator 1', online: true, node_id: '${'1'.repeat(40)}', app_hash: '${'CD'.repeat(32)}',
      block_hash: '${blockHash}', canonical_commit_height: 9, observation: 'canonical commit signature observed via pinned local full replica' }
  ] }; renderValidators()`);
  let details = findNode(held.get('validators'), node => node?.tagName === 'details' && node?.className === 'validator-technical');
  assert.ok(details); details.open = true; details.ontoggle(); details.children[0].focus();
  held.run(`state.validators.observed_at = '2026-11-12T00:00:04Z'; renderValidators()`);
  details = findNode(held.get('validators'), node => node?.tagName === 'details' && node?.className === 'validator-technical');
  assert.equal(details.open, true);
  assert.equal(held.document.activeElement, details.children[0]);
});

test('invalid bid feedback disables submission and a corrected ordinary click succeeds', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '50'; input.oninput();
  assert.equal(button.disabled, true); assert.match(input.validationMessage, /at least 100/);
  assert.equal(button.click(), undefined); assert.equal(held.calls.bids.length, 0);
  input.value = '600'; input.oninput(); assert.equal(button.disabled, false);
  await button.click(); await settle(); assert.equal(held.calls.bids.length, 1);
});

test('repeated ordinary clicks while bid authorization is pending cannot create a second payment action', async () => {
  const bidGate = deferred(), verifyGate = deferred(), held = await fixture({ auctionSeller: otherActor, bidGate });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput();
  const first = button.click(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Checking identity…'); assert.equal(button['aria-busy'], 'true');
  assert.equal(button.dataset.loading, 'true'); assert.match(held.get('message').textContent, /do not retry/);
  assert.equal(button.click(), undefined); assert.equal(held.calls.bids.length, 1);
  held.gateNextStateRead(verifyGate); bidGate.resolve(); await settle();
  assert.equal(button.textContent, 'Refreshing committed view…'); assert.equal(button.disabled, true);
  assert.equal(held.calls.bids.length, 1);
  verifyGate.resolve(); await first; await settle();
  assert.equal(held.calls.bids.length, 1);
  assert.equal(button.textContent, 'Authorize funded bid'); assert.equal(button['aria-busy'], 'false');
  assert.equal(button.dataset.loading, 'false'); assert.match(held.get('message').textContent, /Bid committed at height 3/);
});

test('bid progress reports signer wait, elapsed time and slow guidance without an ETA or percentage', async () => {
  const gate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidPhases: ['checking_auction', 'awaiting_intent_signature'],
    bidPhaseGate: { phase: 'awaiting_intent_signature', gate } });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput();
  const pending = button.click(); await settle();
  assert.equal(button.textContent, 'Signer · bid intent…'); assert.equal(button.disabled, true);
  const progress = findNode(held.get('auctions'), node => node?.className === 'bid-progress');
  assert.ok(progress); assert.equal(progress.hidden, false); assert.equal(progress['aria-live'], 'polite');
  assert.equal(progress.children[0].textContent, 'Signer · bid intent');
  assert.match(progress.children[1].textContent, /Approve the exact bid intent/);
  held.advance(9000);
  const timer = held.intervals.filter(interval => interval.ms === 1000).at(-1); assert.ok(timer); timer.run();
  assert.equal(progress.children[2].textContent, '9s total · 9s this stage');
  assert.match(progress.children[1].textContent, /Still working.*do not click again/);
  assert.doesNotMatch(progress.textContent + progress.children.map(child => child.textContent).join(' '), /%|remaining|ETA/i);
  assert.equal(button.click(), undefined); assert.equal(held.calls.bids.length, 1);
  gate.resolve(); await pending; await settle();
  assert.equal(progress.hidden, true); assert.equal(button.textContent, 'Authorize funded bid');
  assert.equal(held.calls.bids.length, 1);
});

test('bid progress separates three signer stages, authority, consensus and post-commit refresh using monotonic local timing', async () => {
  const fundingSignatureGate = deferred(), bidGate = deferred(), maintenanceGate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidGate,
    bidPhases: ['awaiting_intent_signature', 'awaiting_funding_signature', 'awaiting_bid_signature',
      'contacting_authority', 'confirming_consensus'],
    bidPhaseGate: { phase: 'awaiting_funding_signature', gate: fundingSignatureGate } });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput();
  const pending = button.click(); await settle();
  const progress = findNode(held.get('auctions'), node => node?.className === 'bid-progress');
  assert.equal(button.textContent, 'Signer · funding authorization…');
  assert.equal(progress.children[0].textContent, 'Signer · funding authorization');
  held.advance(4000); held.intervals.filter(interval => interval.ms === 1000).at(-1).run();
  assert.equal(progress.children[2].textContent, '4s total · 4s this stage');

  fundingSignatureGate.resolve(); await settle();
  assert.equal(button.textContent, 'Confirming bid…');
  assert.equal(progress.children[0].textContent, 'Confirming bid');
  assert.equal(progress.children[2].textContent, '4s total · 0s this stage');
  held.advance(6000); held.intervals.filter(interval => interval.ms === 1000).at(-1).run();
  assert.equal(progress.children[2].textContent, '10s total · 6s this stage');

  held.run('state.maintenanceNextAt = 0'); held.gateNextImport(maintenanceGate); bidGate.resolve(); await settle();
  assert.equal(button.textContent, 'Refreshing committed view…');
  assert.equal(progress.children[0].textContent, 'Refreshing committed view');
  assert.match(progress.children[1].textContent, /committed result before payment maintenance finishes/);
  assert.match(progress.children[2].textContent, /^10s total · 0s this stage$/);
  assert.deepEqual(held.calls.bidProgress, ['awaiting_intent_signature', 'awaiting_funding_signature',
    'awaiting_bid_signature', 'contacting_authority', 'confirming_consensus']);
  maintenanceGate.resolve(); await pending; await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(progress.hidden, true);
});

test('a bid queued behind exact maintenance shows wallet wait before starting one payment', async () => {
  const bidGate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidPhases: ['opening_wallet'], bidGate });
  const maintenanceGate = deferred(); held.gateNextImport(maintenanceGate);
  const maintenance = held.run('runMaintenance(scope(), { force: true })'); await settle();
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput();
  const pending = button.click(); await settle();
  assert.equal(button.textContent, 'Waiting for wallet…'); assert.equal(held.calls.bids.length, 0);
  assert.match(held.get('message').textContent, /single-operation wallet lane/);
  maintenanceGate.resolve(); await maintenance; await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(button.textContent, 'Opening wallet…');
  bidGate.resolve(); await pending; await settle(); assert.equal(held.calls.bids.length, 1);
});

test('stale progress callbacks after identity navigation cannot relabel the new session', async () => {
  const gate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidPhases: ['awaiting_signature', 'confirming_consensus'],
    bidPhaseGate: { phase: 'awaiting_signature', gate } });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); const pending = button.click(); await settle();
  assert.equal(button.textContent, 'Waiting for signer…');
  held.run(`disconnect(); message('New session', 'info')`); gate.resolve(); await pending; await settle();
  assert.notEqual(button.textContent, 'Confirming bid…');
  assert.equal(held.get('message').textContent, 'New session');
  assert.equal(held.calls.bids.length, 1);
});

test('failed bid authorization restores the same control without implying success or repeating payment', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.calls.bidFailures = 1;
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); await button.click(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Authorize funded bid'); assert.equal(button['aria-busy'], 'false');
  assert.equal(button.dataset.loading, 'false'); assert.match(held.get('message').textContent, /transient bid callback failed/);
  assert.doesNotMatch(held.get('message').textContent, /Bid committed/);
});

test('a retained post-lock bid becomes one explicit exact-resume action instead of an ordinary retry', async () => {
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'resume_required' });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); await button.click(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.resumes.length, 0);
  assert.match(held.get('message').textContent, /retained.*Resume exact bid/i);
  const resume = findNode(held.get('auctions'), node => node?.textContent === 'Resume exact bid');
  assert.ok(resume); await resume.click(); await settle();
  assert.deepEqual(held.calls.resumes, ['bid-operation']);
  assert.equal(held.calls.bids.length, 1, 'resume must not create a second bid operation');
  assert.match(held.get('message').textContent, /Bid committed at height 4/);
});

test('committed consensus state overrides a stale exact-resume response without a second payment', async () => {
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'resume_required', commitBeforeResumeResult: true });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); await button.click(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.resumes.length, 0);
  assert.match(held.get('message').textContent, /committed.*canonical state.*no resume/i);
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Resume exact bid'), undefined);
  assert.equal(held.run(`state.bidRecoveries.has('a1')`), false);
  assert.equal(held.run(`state.bidDrafts.has('${actor}\u0000deployment-one\u0000a1')`), false);
  assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1').value, '');
});

test('a pre-commit polling refresh cannot preserve stale exact-resume after canonical commitment', async () => {
  const bidGate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'resume_required',
    commitBeforeResumeResult: true, bidGate });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); const pendingBid = button.click(); await pause();
  const staleRefresh = held.run(`refresh()`); await pause();
  bidGate.resolve(); await pendingBid; await staleRefresh; await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.resumes.length, 0);
  assert.match(held.get('message').textContent, /committed.*canonical state.*no resume/i);
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Resume exact bid'), undefined);
  assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1').value, '');
});

test('a canonical bid with changed immutable terms cannot clear exact recovery', async () => {
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'resume_required',
    commitBeforeResumeResult: true, committedResumeAmount: 601 });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); await button.click(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.resumes.length, 0);
  assert.match(held.get('message').textContent, /retained.*Resume exact bid/i);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Resume exact bid'));
  assert.equal(held.run(`state.bidRecoveries.has('a1')`), true);
});

test('duplicate canonical rows for one funding operation stay fail-closed', async () => {
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'resume_required',
    commitBeforeResumeResult: true, duplicateCommittedResume: true });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); await button.click(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.resumes.length, 0);
  assert.match(held.get('message').textContent, /retained.*Resume exact bid/i);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Resume exact bid'));
  assert.equal(held.run(`state.bidRecoveries.has('a1')`), true);
});

test('identity change during canonical bid reconciliation cannot adopt the prior actor operation', async () => {
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'resume_required', commitBeforeResumeResult: true });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  const gate = deferred(); held.gateNextStateRead(gate);
  input.value = '600'; input.oninput(); const pending = button.click(); await pause();
  held.run(`disconnect(); message('New session', 'info')`); gate.resolve(); await pending; await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.resumes.length, 0);
  assert.equal(held.get('message').textContent, 'New session');
  assert.equal(held.run(`state.bidRecoveries.size`), 0);
  assert.equal(held.get('actor').textContent, 'Disconnected');
});

test('a timeout after funds are reserved ends in exact resume UI without a duplicate payment', async () => {
  const gate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidStatus: 'resume_required', bidPhases: ['reserving_funds'],
    bidPhaseGate: { phase: 'reserving_funds', gate } });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); const pending = button.click(); await settle();
  assert.equal(button.textContent, 'Reserving funds…'); assert.equal(button.disabled, true);
  assert.equal(held.calls.bids.length, 1); assert.equal(button.click(), undefined);
  gate.resolve(); await pending; await settle();
  const resume = findNode(held.get('auctions'), node => node?.textContent === 'Resume exact bid');
  assert.ok(resume); assert.match(held.get('message').textContent, /retained.*No second payment/i);
  await resume.click(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.deepEqual(held.calls.resumes, ['bid-operation']);
});

test('readiness and committed-state recovery update the same stable bid controls fail-closed', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); input.focus();
  held.failState(true); held.readiness(false);
  await assert.rejects(() => held.run('state.readinessNextAt=0; refresh()'), /committed state unavailable/); await settle();
  assert.equal(button.disabled, true); assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1'), input);
  held.readiness(true);
  await assert.rejects(() => held.run('state.readinessNextAt=0; refresh()'), /committed state unavailable/); await settle();
  assert.equal(button.disabled, true, 'readiness alone must not re-enable bidding on a stale public view');
  held.failState(false); await held.run('state.readinessNextAt=0; refresh()'); await settle();
  assert.equal(button.disabled, false); assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid'), button);
  assert.equal(held.document.activeElement, input);
});

test('runtime recovery cannot re-enable a bid before the next committed-state read succeeds', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput();
  held.readiness(false); await held.run('state.readinessNextAt=0; refresh()'); await settle();
  assert.equal(held.run('state.publicStateAvailable'), true);
  assert.equal(button.disabled, true);
  const stateGate = deferred(); held.gateNextStateRead(stateGate); held.readiness(true);
  const recovering = held.run('state.readinessNextAt=0; refresh()'); await settle();
  assert.equal(held.run('state.publicStateAvailable'), false);
  assert.equal(button.disabled, true);
  held.failState(true); stateGate.resolve();
  await assert.rejects(() => recovering, /committed state unavailable/); await settle();
  assert.equal(button.disabled, true); assert.equal(held.calls.bids.length, 0);
});

test('a wallet read failure pauses new bids until a complete refresh succeeds', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput();
  held.failBalance(true); await held.run('refresh()'); await settle();
  assert.equal(button.disabled, true);
  assert.ok(findNode(held.get('notes'), node => node?.textContent === 'Wallet state unavailable'));
  held.failBalance(false); await held.run('refresh()'); await settle();
  assert.equal(button.disabled, false);
});

test('a stale failed refresh cannot pause or relabel a newer identity generation', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const gate = deferred(); held.gateNextStateRead(gate); held.failState(true);
  const oldRefresh = held.run('refresh()'); await settle();
  held.run(`state.generation += 1; state.publicStateAvailable = true; state.marketPhase = 'ready'; state.marketError = 'new-session-state'`);
  gate.resolve(); await oldRefresh; await settle();
  assert.equal(held.run('state.publicStateAvailable'), true);
  assert.equal(held.run('state.marketPhase'), 'ready');
  assert.equal(held.run('state.marketError'), 'new-session-state');
});

test('stale maintenance failure cannot label a newer identity return state', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const gate = deferred(); held.gateNextImport(gate);
  const oldMaintenance = held.run('state.maintenanceNextAt=0; runMaintenance(scope(), { force: true })'); await settle();
  held.calls.importFailures = 1;
  held.run(`state.generation += 1; state.maintenanceChecking = false; state.maintenanceError = 'new-session-state'`);
  gate.resolve(); await oldMaintenance; await settle();
  assert.equal(held.run('state.maintenanceChecking'), false);
  assert.equal(held.run('state.maintenanceError'), 'new-session-state');
});

test('release identity invalidation immediately removes stale participant controls and labels', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  assert.ok(findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1'));
  held.run('invalidateReadinessIdentity()'); await settle();
  assert.equal(findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1'), undefined);
  assert.equal(held.run('state.view === null && state.validators === null'), true);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Loading auctions'));
  assert.equal(held.get('actor').textContent, 'Disconnected');
});

test('prepared and unknown bid outcomes are never presented as committed success', async () => {
  for (const bidStatus of ['prepared', 'unknown']) {
    const held = await fixture({ auctionSeller: otherActor, bidStatus });
    await held.run('placeBid("a1", 600)'); await settle();
    assert.equal(held.get('message').dataset.tone, 'warning');
    assert.doesNotMatch(held.get('message').textContent, /Bid committed/);
    assert.match(held.get('message').textContent, bidStatus === 'prepared' ? /not yet committed/ : /unknown outcome/);
  }
});

test('changed draft stays intact when an earlier exact bid is recovered after the leader changes', async () => {
  const held = await fixture({ auctionSeller: otherActor, recoveredBidAmount: 600 });
  held.run(`state.view.state.bids.leader = { id: 'leader', auction_id: 'a1', bidder: '${otherActor}', amount: 800, committed_at: 2 };
    state.view.state.auctions.a1.leader_bid_id = 'leader'; state.view.state.auctions.a1.high_bid = 800; renderAuctions()`);
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '900'; input.oninput(); await button.onclick(); await settle();
  assert.equal(held.calls.bids.length, 1); assert.equal(held.calls.bids[0].replacesBidId, 'leader');
  assert.match(held.get('message').textContent, /prior 600 bid/);
  assert.match(held.get('message').textContent, /new 900 draft was not submitted/);
  const retained = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  assert.equal(retained.value, '900');
});

test('quick bid choices are keyboard buttons and repeated submission is suppressed', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const quick = findNode(held.get('auctions'), node => node?.textContent === 'Jump · 300');
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  assert.ok(quick); assert.equal(quick.type, 'button'); quick.onclick();
  assert.equal(input.value, '300'); assert.equal(button.disabled, false);
  await Promise.all([button.onclick(), button.onclick()]); await settle();
  assert.equal(held.calls.bids.length, 1);
});

test('the committed leader sees a disabled own-raise control before the fail-closed protocol guard', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 600, committed_at: 3, integrated_funding_id: 'leading-pool' };
    state.view.state.auctions.a1.leader_bid_id = 'mine'; state.view.state.auctions.a1.high_bid = 600; renderAuctions()`);
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.tagName === 'button' && node?.textContent === 'You’re leading');
  const error = findNode(held.get('auctions'), node => node?.textContent === 'Increasing your own leading bid is not supported yet.');
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'You’re leading'));
  assert.ok(button); assert.equal(button.disabled, true); assert.equal(input.disabled, true); assert.ok(error);
  button.click(); await settle();
  assert.equal(held.calls.bids.length, 0);
  await assert.rejects(() => held.run('placeBid("a1", 700)'), /Own raises remain fail-closed/);
  assert.equal(held.calls.bids.length, 0);
});

test('deferred payment maintenance cannot mix a newly committed leader with the previous price, deadline or controls', async () => {
  const bidGate = deferred(), maintenanceGate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidGate });
  const oldEnd = 1900000000, newEnd = oldEnd + 180;
  held.view.state.bids.other = { id: 'other', auction_id: 'a1', bidder: otherActor,
    amount: 150, committed_at: 2, integrated_funding_id: 'other-pool' };
  Object.assign(held.view.state.auctions.a1, { high_bid: 150, min_increment: 50,
    leader_bid_id: 'other', end_time: oldEnd });
  await held.run('refresh()'); await settle();

  let card = findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1');
  let price = findNode(card, node => node?.className === 'bid-metric').children[1];
  let status = findNode(card, node => String(node?.className || '').startsWith('status-card'));
  let deadline = findNode(card, node => node?.tagName === 'time');
  let input = findNode(card, node => node?.dataset?.auctionBidId === 'a1');
  let button = findNode(card, node => node?.textContent === 'Authorize funded bid');
  assert.equal(price.textContent, '150'); assert.equal(status.children[0].textContent, 'Ready to bid');
  assert.equal(deadline.datetime, new Date(oldEnd * 1000).toISOString());
  input.value = '200'; input.oninput(); assert.equal(button.disabled, false);

  const pending = button.click(); await settle();
  held.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: actor,
    amount: 200, committed_at: 3, integrated_funding_id: 'own-committed-pool' };
  Object.assign(held.view.state.auctions.a1, { high_bid: 200, leader_bid_id: 'mine', end_time: newEnd });
  held.view.state.height = 2;
  held.run('state.maintenanceNextAt = 0'); held.gateNextImport(maintenanceGate); bidGate.resolve(); await settle();

  card = findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1');
  price = findNode(card, node => node?.className === 'bid-metric').children[1];
  status = findNode(card, node => String(node?.className || '').startsWith('status-card'));
  deadline = findNode(card, node => node?.tagName === 'time');
  input = findNode(card, node => node?.dataset?.auctionBidId === 'a1');
  assert.equal(price.textContent, '150', 'price moved before the coherent committed snapshot was published');
  assert.equal(status.children[0].textContent, 'Ready to bid', 'leadership moved ahead of the price snapshot');
  assert.equal(deadline.datetime, new Date(oldEnd * 1000).toISOString(), 'deadline moved ahead of the price snapshot');
  assert.equal(input.value, '', 'the exact successful draft was not cleared before the committed refresh');

  maintenanceGate.resolve(); await pending; await settle();
  held.run('syncAuctionCountdowns()');
  card = findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1');
  price = findNode(card, node => node?.className === 'bid-metric').children[1];
  status = findNode(card, node => String(node?.className || '').startsWith('status-card'));
  deadline = findNode(card, node => node?.tagName === 'time');
  input = findNode(card, node => node?.dataset?.auctionBidId === 'a1');
  button = findNode(card, node => node?.tagName === 'button' && node?.textContent === 'You’re leading');
  assert.equal(price.textContent, '200'); assert.equal(status.children[0].textContent, 'You’re leading');
  assert.equal(deadline.datetime, new Date(newEnd * 1000).toISOString());
  assert.equal(input.value, ''); assert.equal(input.disabled, true); assert.equal(button.disabled, true);
  assert.ok(findNode(card, node => node?.textContent === 'Increasing your own leading bid is not supported yet.'));
  assert.equal(held.run(`state.bidDrafts.has(scope() + '\\u0000a1')`), false);
  assert.equal(held.calls.bids.length, 1);
});

test('deferred payment maintenance cannot mark only the previous open card as closed', async () => {
  const maintenanceGate = deferred();
  const held = await fixture();
  await held.run('refresh()'); await settle();
  let card = findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1');
  assert.ok(findNode(card, node => node?.textContent === 'Consensus time controls anti-sniping extension and close eligibility.'));

  Object.assign(held.view.state.auctions.a1, { status: 'closed', winner: otherActor, closed_at: 1900000010 });
  held.run('state.maintenanceNextAt = 0'); held.gateNextImport(maintenanceGate);
  const pending = held.run('refresh()'); await settle();
  held.run('syncAuctionCountdowns()');

  card = findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1');
  assert.ok(findNode(card, node => node?.textContent === 'Consensus time controls anti-sniping extension and close eligibility.'));
  assert.equal(findNode(card, node => node?.textContent === 'Closed · committed'), undefined,
    'the one-second timer exposed the unpublished closed snapshot');

  maintenanceGate.resolve(); await pending; await settle();
  held.run('syncAuctionCountdowns()');
  card = findNode(held.get('auctions'), node => node?.dataset?.auctionId === 'a1');
  assert.ok(findNode(card, node => node?.textContent === 'Closed · committed'));
  assert.equal(findNode(card, node => node?.textContent === 'Consensus time controls anti-sniping extension and close eligibility.'), undefined);
});

test('a changed fresh draft survives successful admission and the next catalogue rerender', async () => {
  const bidGate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidGate });
  let input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput();
  const pending = button.click(); await settle();

  input.value = '900'; input.oninput();
  bidGate.resolve(); await pending; await settle();
  assert.equal(held.run(`state.bidDrafts.get(scope() + '\u0000a1')`), '900');

  held.run('state.auctionRenderKey = ""; renderAuctions()');
  input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  assert.equal(input.value, '900');
  assert.equal(held.calls.bids.length, 1);
});

test('auction rerenders preserve keyboard focus on quick and primary bid controls', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  let quick = findNode(held.get('auctions'), node => node?.textContent === 'Jump · 300'); quick.focus();
  held.run('renderAuctions()');
  quick = findNode(held.get('auctions'), node => node?.textContent === 'Jump · 300');
  assert.equal(Element.activeElement, quick);
  let button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid'); button.focus();
  held.run('renderAuctions()');
  button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  assert.equal(Element.activeElement, button);
});

test('listing and bid amounts above the advertised payout ceiling fail before signing or payment intent', async () => {
  const seller = await fixture();
  seller.get('title').value = 'Too expensive'; seller.get('description').value = '';
  seller.get('image').value = ''; seller.get('duration').value = '10'; seller.get('starting').value = '50001';
  seller.get('increment').value = '100'; seller.get('reserve').value = '0';
  await seller.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(seller.calls.listingSigns, 0); assert.match(seller.get('message').textContent, /through 50,000/);
  const bidder = await fixture({ auctionSeller: otherActor });
  await assert.rejects(() => bidder.run('placeBid("a1", 50001)'), /up to 50,000/);
  assert.equal(bidder.calls.bids.length, 0);
});

test('legacy or mismatched policy pins preserve exact recovery but block every new funded bid', async () => {
  for (const mutation of [
    `state.releasePins.schema = releasePinsSchemaV1; delete state.releasePins.auction_policy_digest;
      delete state.releasePins.auction_payment_policy_digest; delete state.releasePins.validators_hash`,
    `state.releasePins.auction_policy_digest = '${'44'.repeat(32)}'`,
    `state.releasePins.auction_payment_policy_digest = '${'55'.repeat(32)}'`,
  ]) {
    const held = await fixture({ auctionSeller: otherActor });
    held.run(`${mutation}; updateControls(); renderAuctions()`);
    const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
    const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
    input.value = '600'; input.oninput();
    assert.equal(button.disabled, true); assert.equal(held.get('process-payments').hidden, true);
    const error = await held.run('placeBid("a1", 600)').then(() => null, value => value);
    assert.match(error?.message || '', /reviewed one-hour auction and payment policies are not bound/);
    assert.equal(held.calls.bids.length, 0);
  }
});

test('successful outbid return import is tied to the latest exact funding operation', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.bids.older = { id: 'older', auction_id: 'a1', bidder: '${actor}', amount: 100, committed_at: 1, integrated_funding_id: 'refund-operation-old' };
    state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 200, committed_at: 2, integrated_funding_id: 'refund-operation-latest' }; renderAuctions()`);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'You were outbid · return scheduled'));
  held.calls.importedRefundOperationIds.push('refund-operation-old');
  await held.run('runMaintenance(scope(), { force: true })'); held.run('renderAuctions()');
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'You were outbid · return scheduled'));
  held.calls.importedRefundOperationIds.push('refund-operation-latest');
  await held.run('runMaintenance(scope(), { force: true })'); held.run('renderAuctions()');
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Outbid return settled'));
});

test('an observed outbid is polled automatically on the short cadence and becomes imported without a manual click', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 100,
    committed_at: 2, integrated_funding_id: 'refund-operation-latest' };
    state.view.state.auctions.a1.leader_bid_id = 'other';
    state.view.state.bids.other = { id: 'other', auction_id: 'a1', bidder: '${otherActor}', amount: 200, committed_at: 3 };
    state.maintenanceNextAt = 0; renderAuctions()`);
  const before = held.calls.imports;
  await held.run('runMaintenance(scope())');
  assert.equal(held.calls.imports, before + 1);
  assert.equal(held.run('state.maintenanceNextAt - readinessNow()'), 4000);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'You were outbid · return scheduled'));
  held.calls.importedRefundOperationIds.push('refund-operation-latest'); held.advance(4000);
  await held.run('runMaintenance(scope())');
  assert.equal(held.calls.imports, before + 2);
  assert.equal(held.run('state.maintenanceNextAt - readinessNow()'), 15000);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Outbid return settled'));
});

test('a newly observed outbid bypasses an old idle backoff without creating another payment', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const before = held.calls.imports;
  held.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: actor, amount: 100,
    committed_at: 2, integrated_funding_id: 'refund-newly-observed' };
  held.view.state.auctions.a1.leader_bid_id = 'other';
  held.view.state.bids.other = { id: 'other', auction_id: 'a1', bidder: otherActor, amount: 200, committed_at: 3 };
  held.run('state.maintenanceNextAt = readinessNow() + 120000');
  held.calls.importedRefundOperationIds.push('refund-newly-observed');
  await held.run('refresh()'); await settle();
  assert.equal(held.calls.imports, before + 1);
  assert.equal(held.calls.bids.length, 0);
  assert.equal(held.run(`state.importedReturnOperations.has('refund-newly-observed')`), true);
});

test('an older losing operation is imported even when this bidder has a newer leading bid', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.bids.older = { id: 'older', auction_id: 'a1', bidder: '${actor}', amount: 100,
      committed_at: 1, integrated_funding_id: 'refund-older-loss' };
    state.view.state.bids.latest = { id: 'latest', auction_id: 'a1', bidder: '${actor}', amount: 300,
      committed_at: 3, integrated_funding_id: 'current-leading-pool' };
    state.view.state.auctions.a1.leader_bid_id = 'latest'; state.view.state.auctions.a1.high_bid = 300;
    state.maintenanceNextAt = 0; renderAuctions()`);
  held.calls.importedRefundOperationIds.push('refund-older-loss');
  await held.run('runMaintenance(scope())'); await settle();
  assert.equal(held.run(`state.importedReturnOperations.has('refund-older-loss')`), true);
  assert.equal(held.run(`state.importedReturnOperations.has('current-leading-pool')`), false);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'You’re leading'));
});

test('committed-state failure still recovers retained exact returns but keeps new bidding paused', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 100,
      committed_at: 2, integrated_funding_id: 'refund-during-public-failure' };
    state.view.state.auctions.a1.leader_bid_id = 'other';
    state.view.state.bids.other = { id: 'other', auction_id: 'a1', bidder: '${otherActor}', amount: 200, committed_at: 3 };
    state.maintenanceNextAt = 0; renderAuctions()`);
  held.calls.importedRefundOperationIds.push('refund-during-public-failure'); held.failState(true);
  await assert.rejects(() => held.run('refresh()'), /committed state unavailable/); await settle();
  assert.equal(held.run(`state.importedReturnOperations.has('refund-during-public-failure')`), true);
  assert.equal(held.run('state.publicStateAvailable'), false);
  assert.match(held.get('message').textContent, /exact retained payment recovery remains available/);
  assert.equal(held.get('message').dataset.tone, 'warning');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  assert.equal(button.disabled, true); assert.equal(held.calls.bids.length, 0);
});

test('a stalled committed-state body times out, recovers retained returns, and pauses new bids', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 100,
      committed_at: 2, integrated_funding_id: 'refund-after-state-timeout' };
    state.view.state.auctions.a1.leader_bid_id = 'other';
    state.view.state.bids.other = { id: 'other', auction_id: 'a1', bidder: '${otherActor}', amount: 200, committed_at: 3 };
    state.maintenanceNextAt = 0; renderAuctions()`);
  held.calls.importedRefundOperationIds.push('refund-after-state-timeout'); held.hangState(true);
  const stalled = held.run('refresh()'); await settle(); held.fireTimeouts();
  await assert.rejects(() => stalled, /Committed state read timed out/); await settle();
  assert.equal(held.run(`state.importedReturnOperations.has('refund-after-state-timeout')`), true);
  assert.equal(held.run('state.publicStateAvailable'), false);
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  assert.equal(button.disabled, true); assert.equal(held.calls.bids.length, 0);
});

test('automatic return failure is visible, retries with bounded backoff, and never needs a second payment action', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: '${actor}', amount: 100,
    committed_at: 2, integrated_funding_id: 'refund-operation-latest' };
    state.view.state.auctions.a1.leader_bid_id = 'other';
    state.view.state.bids.other = { id: 'other', auction_id: 'a1', bidder: '${otherActor}', amount: 200, committed_at: 3 };
    state.maintenanceNextAt = 0; renderAuctions()`);
  held.calls.importFailures = 1;
  await held.run('runMaintenance(scope())');
  assert.equal(held.run('state.maintenanceNextAt - readinessNow()'), 4000);
  assert.match(held.run('state.maintenanceError'), /terminal transport unavailable/);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Automatic return delayed'));
  held.calls.importedRefundOperationIds.push('refund-operation-latest'); held.advance(4000);
  await held.run('runMaintenance(scope())');
  assert.equal(held.run('state.maintenanceError'), '');
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Outbid return settled'));
});

test('manual exact return recovery remains available while new admission is warming up', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const before = held.calls.imports;
  held.run(`state.config.browser_threshold_wallet_ready = false; state.config.browser_threshold_admission_ready = false;
    state.maintenanceError = 'terminal transport unavailable'; updateControls(); renderWallet()`);
  const button = held.get('process-payments');
  assert.equal(button.hidden, false); assert.equal(button.disabled, false);
  await button.onclick({ currentTarget: button }); await settle();
  assert.equal(held.calls.imports, before + 1);
});

test('payments section shows one prioritized action across current and historical recovery cards', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.auctions.a2 = { ...state.view.state.auctions.a1, id: 'a2', status: 'closed', end_time: 1700000000 };
    state.wallet = { available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0 };
    state.bidRecoveries = new Map([
      ['a1', { auctionId: 'a1', fundingOperationId: 'current-operation', retainedBidAmount: 300, recoveryStage: 'authority_pending' }],
      ['a2', { auctionId: 'a2', fundingOperationId: 'historical-operation', retainedBidAmount: 250, recoveryStage: 'funds_locked' }],
    ]);
    state.expiredPrelockBids = [{ auctionId: 'a2', fundingOperationId: 'historical-operation', bidAmount: 250, expiresAt: 1700000000 }];
    renderWallet()`);
  const button = held.get('process-payments');
  assert.equal(button.hidden, false); assert.equal(button.textContent, 'Resume exact bid');
  assert.equal(findNodes(held.get('notes'), node => node?.tagName === 'button').length, 0);
  assert.ok(findNode(held.get('notes'), node => node?.textContent === 'Current auction recovery · 300 fake sats'));
  assert.ok(findNode(held.get('notes'), node => node?.textContent === 'Earlier auction recovery · 250 fake sats'));
  assert.equal(findNode(held.get('notes'), node => node?.textContent === 'Old pre-lock intent · 250 fake sats'), undefined,
    'one operation must not appear as both resumable and discardable');
  held.run(`state.bidRecoveries.delete('a1'); renderWallet()`);
  assert.equal(button.hidden, true, 'ended historical recovery must remain visible without a misleading resume action');
  assert.equal(held.get('payment-overview').children[0].textContent, 'Earlier bid recovery preserved');
  assert.match(held.get('payment-overview').children[1].textContent, /not a measured current proof balance/);
  assert.equal(held.get('refundable').textContent, '—');
});

test('historical recovery stays visible without masking a different safe action', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.view.state.auctions.a2 = { ...state.view.state.auctions.a1, id: 'a2', status: 'closed', end_time: 1700000000 };
    state.bidRecoveries = new Map([
      ['a2', { auctionId: 'a2', fundingOperationId: 'historical-operation', retainedBidAmount: 250, recoveryStage: 'funds_locked' }],
    ]);
    state.expiredPrelockBids = [{ auctionId: 'a3', fundingOperationId: 'distinct-old-intent', bidAmount: 125, expiresAt: 1700000000 }];
    renderWallet()`);
  const button = held.get('process-payments');
  assert.equal(button.hidden, false); assert.equal(button.textContent, 'Review old bid intent');
  assert.ok(findNode(held.get('notes'), node => node?.textContent === 'Earlier auction recovery · 250 fake sats'));
  assert.ok(findNode(held.get('notes'), node => node?.textContent === 'Old pre-lock intent · 125 fake sats'));
  held.run(`window.confirm = () => false`);
  await button.onclick({ currentTarget: button }); await settle();
  assert.equal(button.hidden, false); assert.equal(button.disabled, false); assert.equal(button.textContent, 'Review old bid intent');
  held.run(`state.maintenanceError = 'automatic status unavailable'; renderWallet()`);
  assert.equal(button.hidden, false); assert.equal(button.textContent, 'Retry payment recovery');
  assert.equal(findNodes(held.get('notes'), node => node?.tagName === 'button').length, 0);
});

test('wallet read failure retains last-known exact recovery references without claiming a balance', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.run(`state.bidRecoveries = new Map([
      ['a1', { auctionId: 'a1', fundingOperationId: 'known-recovery-operation', retainedBidAmount: 300, recoveryStage: 'authority_pending' }],
    ]);
    state.wallet = null; state.walletPhase = 'error'; state.walletError = 'wallet projection unavailable'; renderWallet()`);
  assert.ok(findNode(held.get('notes'), node => node?.textContent === 'Last known · Current auction recovery · 300 fake sats'));
  assert.ok(findNode(held.get('notes'), node => node?.textContent === 'Operation known-recovery-operation'));
  assert.equal(held.get('spendable').textContent, '—'); assert.equal(held.get('locked').textContent, '—');
  assert.equal(held.get('refundable').textContent, '—');
  assert.equal(held.get('process-payments').textContent, 'Retry payment status');
});

test('automatic payment states need no button while uncertain recovery offers one retry', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const button = held.get('process-payments'), overview = held.get('payment-overview');
  const status = (value) => held.run(`state.returnImportStatuses = new Map([['return-one', '${value}']]);
    state.maintenanceError = ''; renderWallet()`);
  status('pending'); assert.equal(overview.children[0].textContent, 'Payment available · importing automatically'); assert.equal(button.hidden, true);
  status('wallet_imported_ack_pending'); assert.equal(overview.children[0].textContent, 'Imported · finishing settlement'); assert.equal(button.hidden, true);
  status('settled'); assert.equal(overview.children[0].textContent, 'Payments settled'); assert.equal(button.hidden, true);
  status('unknown'); assert.equal(overview.children[0].textContent, 'Automatic recovery delayed'); assert.equal(button.hidden, false);
  const gate = deferred(); held.gateNextImport(gate); const before = held.calls.imports;
  const first = button.onclick({ currentTarget: button }); await settle();
  assert.equal(button.disabled, true); assert.equal(button.click(), undefined); assert.equal(held.calls.imports, before + 1);
  held.run(`disconnect(); message('New payment identity', 'info')`); gate.resolve(); await first; await settle();
  assert.equal(held.calls.imports, before + 1); assert.equal(held.get('message').textContent, 'New payment identity');
});

test('committed end time disables the stable bid control while close is pending', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const input = findNode(held.get('auctions'), node => node?.dataset?.auctionBidId === 'a1');
  const button = findNode(held.get('auctions'), node => node?.textContent === 'Authorize funded bid');
  input.value = '600'; input.oninput(); assert.equal(button.disabled, false);
  held.run(`state.view.state.last_consensus_time = state.view.state.auctions.a1.end_time;
    syncAuctionControls(); syncAuctionStatuses()`);
  assert.equal(button.disabled, true); assert.equal(button.textContent, 'Bidding ended');
  assert.equal(button.click(), undefined); assert.equal(held.calls.bids.length, 0);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Auction ended · awaiting close'));
});

test('seller payout is checking, pending, then imported only after an identified successful import', async () => {
  const held = await fixture();
  held.view.state.auctions.a1.status = 'closed'; held.view.state.auctions.a1.winner = otherActor;
  held.run(`state.view.state.auctions.a1.status = 'closed'; state.view.state.auctions.a1.winner = '${otherActor}'; state.maintenanceChecking = true; renderAuctions()`);
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Checking seller payout'));
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout settled'), undefined);
  held.run('state.maintenanceChecking = false; renderAuctions()');
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout pending'));
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout available'), undefined);
  held.run('renderWallet()'); assert.equal(held.get('process-payments').hidden, true);
  held.calls.importedWinnerAuctionIds.push('a1');
  await held.run('runMaintenance(scope(), { force: true })'); await held.run('refresh()'); await settle();
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout settled'), undefined);
  assert.equal(held.get('auction-history-toggle').textContent, 'Show past auctions (1)');
  held.get('auction-history-toggle').onclick();
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout settled'));
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout pending'), undefined);
  held.run('state.importedAuctionPayouts.clear()'); await held.run('refresh()'); await settle();
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout settled'));
});

test('wallet-imported payout remains visible until terminal acknowledgement settles', async () => {
  const held = await fixture();
  held.view.state.auctions.a1.status = 'closed'; held.view.state.auctions.a1.winner = otherActor;
  held.calls.payoutStatus = 'wallet_imported_ack_pending';
  await held.run('refresh()'); await settle();
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout imported · settlement pending'));
  assert.equal(held.get('auction-history-toggle').textContent, 'Show past auctions (0)');
  held.calls.payoutStatus = 'settled';
  await held.run('refresh()'); await settle();
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Seller payout imported · settlement pending'), undefined);
  assert.equal(held.get('auction-history-toggle').textContent, 'Show past auctions (1)');
});

test('wallet-imported outbid return remains actionable until exact terminal acknowledgement settles', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.view.state.auctions.a1.status = 'closed'; held.view.state.auctions.a1.winner = otherActor;
  held.view.state.auctions.a1.leader_bid_id = 'other';
  held.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: actor, amount: 100,
    committed_at: 2, integrated_funding_id: 'refund-ack-pending' };
  held.calls.returnStatus = 'wallet_imported_ack_pending';
  await held.run('refresh()'); await settle();
  assert.ok(findNode(held.get('auctions'), node => node?.textContent === 'Outbid return imported · settlement pending'));
  assert.equal(held.get('auction-history-toggle').textContent, 'Show past auctions (0)');
  held.calls.returnStatus = 'settled';
  await held.run('refresh()'); await settle();
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Outbid return imported · settlement pending'), undefined);
  assert.equal(held.get('auction-history-toggle').textContent, 'Show past auctions (1)');
});

test('refresh repairs an acknowledgement-only outbid return even after public payment discovery is absent', async () => {
  const held = await fixture({ auctionSeller: otherActor, enableAckRepair: true });
  held.view.state.auctions.a1.status = 'closed'; held.view.state.auctions.a1.winner = otherActor;
  held.view.state.auctions.a1.leader_bid_id = 'other';
  held.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: actor, amount: 100,
    committed_at: 2, integrated_funding_id: 'legacy-refund-ack' };
  held.calls.returnStatus = 'wallet_imported_ack_pending';
  await held.run('refresh()'); await settle();
  assert.deepEqual(held.calls.ackRepairs, ['legacy-refund-ack']);
  assert.equal(held.run(`state.importedReturnOperations.has('legacy-refund-ack')`), true);
  assert.equal(findNode(held.get('auctions'), node => node?.textContent === 'Outbid return imported · settlement pending'), undefined);
});

test('failed acknowledgement-only repair uses the same increasing maintenance backoff', async () => {
  const held = await fixture({ auctionSeller: otherActor, enableAckRepair: true });
  held.view.state.auctions.a1.status = 'closed'; held.view.state.auctions.a1.winner = otherActor;
  held.view.state.auctions.a1.leader_bid_id = 'other';
  held.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: actor, amount: 100,
    committed_at: 2, integrated_funding_id: 'legacy-refund-ack-backoff' };
  held.calls.returnStatus = 'wallet_imported_ack_pending'; held.calls.ackRepairFailures = 3;
  await held.run('state.maintenanceNextAt=0; refresh()'); await settle();
  assert.equal(held.calls.ackRepairs.length, 1);
  await held.run('refresh()'); await settle();
  held.advance(3999); await held.run('refresh()'); await settle();
  assert.equal(held.calls.ackRepairs.length, 1, 'ack repair retried before the four-second backoff');
  held.advance(1); await held.run('refresh()'); await settle();
  assert.equal(held.calls.ackRepairs.length, 2);
  held.advance(4000); await held.run('refresh()'); await settle();
  assert.equal(held.calls.ackRepairs.length, 2, 'second failure did not increase ack repair backoff to eight seconds');
  held.advance(3999); await held.run('refresh()'); await settle();
  assert.equal(held.calls.ackRepairs.length, 2);
  held.advance(1); await held.run('refresh()'); await settle();
  assert.equal(held.calls.ackRepairs.length, 3);
});

test('refresh repairs exact seller payout discovery for owned closed auctions before import maintenance', async () => {
  const held = await fixture();
  held.view.state.auctions.a1.status = 'closed'; held.view.state.auctions.a1.winner = otherActor;
  await held.run('refresh()'); await settle();
  assert.ok(held.calls.repairs.includes('a1'));
});

test('persistent seller repair failure preserves maintenance backoff and both exact failures', async () => {
  const held = await fixture();
  held.view.state.auctions.a1.status = 'closed'; held.view.state.auctions.a1.winner = otherActor;
  held.calls.repairFailures = 4; held.calls.importFailures = 2;
  const before = held.calls.imports;
  await held.run('state.maintenanceNextAt=0; refresh()');
  await settle();
  assert.equal(held.calls.imports, before + 1);
  const failure = held.run('state.walletError');
  assert.match(failure, /2 exact recovery repair\(s\) remain pending/);
  assert.match(failure, /seller payout discovery a1: seller discovery unavailable/);
  assert.match(failure, /terminal transport unavailable/);
  await held.run('refresh()'); await settle();
  assert.equal(held.calls.imports, before + 1, 'four-second refresh bypassed the maintenance backoff');
  held.advance(14999); await held.run('refresh()'); await settle();
  assert.equal(held.calls.imports, before + 1, 'maintenance retried before its idle backoff elapsed');
  held.advance(1); await held.run('refresh()'); await settle();
  assert.equal(held.calls.imports, before + 2, 'maintenance did not retry after its backoff elapsed');
  assert.match(held.run('state.walletError'), /terminal transport unavailable/);
});

test('manual payment button imports returns and payouts only', async () => {
  const held = await fixture(); const before = held.calls.imports;
  held.run(`state.maintenanceError = 'terminal transport unavailable'; renderWallet()`);
  const button = held.get('process-payments');
  assert.equal(button.hidden, false);
  await button.onclick({ currentTarget: button }); await settle();
  assert.ok(held.calls.imports > before); assert.equal(held.calls.sellerPlans, 0);
});

test('manual import preserves both the payment failure and the following refresh failure', async () => {
  const held = await fixture(); held.calls.importFailures = 2; held.failState(true);
  held.run(`state.maintenanceError = 'terminal transport unavailable'; renderWallet()`);
  const button = held.get('process-payments'); await button.onclick({ currentTarget: button }); await settle();
  assert.match(held.get('message').textContent, /terminal transport unavailable/);
  assert.match(held.get('message').textContent, /Wallet\/status refresh also failed: committed state unavailable/);
  assert.equal(button.disabled, false); assert.match(button.textContent, /^Retry payment (?:status|recovery)$/);
});

test('background refresh throttles wallet maintenance while manual import bypasses the interval', async () => {
  const held = await fixture(); const before = held.calls.imports;
  await held.run('refresh()'); await held.run('refresh()'); await settle();
  assert.equal(held.calls.imports, before);
  held.run(`state.maintenanceError = 'terminal transport unavailable'; renderWallet()`);
  const button = held.get('process-payments');
  await button.onclick({ currentTarget: button }); await settle();
  assert.equal(held.calls.imports, before + 1);
});

test('a hung validator-evidence read cannot block exact return maintenance or committed state', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.view.state.bids.mine = { id: 'mine', auction_id: 'a1', bidder: actor, amount: 100,
    committed_at: 2, integrated_funding_id: 'refund-with-hung-validator' };
  held.view.state.auctions.a1.leader_bid_id = 'other';
  held.view.state.bids.other = { id: 'other', auction_id: 'a1', bidder: otherActor, amount: 200, committed_at: 3 };
  held.calls.importedRefundOperationIds.push('refund-with-hung-validator');
  const validatorGate = deferred(); held.gateNextValidatorRead(validatorGate);
  const before = held.calls.imports;
  await held.run('state.maintenanceNextAt=0; refresh()'); await settle();
  assert.equal(held.calls.imports, before + 1);
  assert.equal(held.run(`state.importedReturnOperations.has('refund-with-hung-validator')`), true);
  assert.equal(held.run('state.publicStateAvailable'), true);
  validatorGate.resolve(); await settle();
});

test('concurrent forced maintenance requests remain serialized', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const importGate = deferred(); held.gateNextImport(importGate);
  const first = held.run('runMaintenance(scope(), { force: true })'); await settle();
  const second = held.run('runMaintenance(scope(), { force: true })'); await settle();
  assert.equal(held.calls.maxConcurrentImports, 1);
  importGate.resolve(); await Promise.all([first, second]); await settle();
  assert.equal(held.calls.maxConcurrentImports, 1);
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
  held.get('image').value = ''; held.get('duration').value = '10'; held.get('starting').value = '100';
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

test('seller duration outside the backend range fails before signing and shows the policy error', async () => {
  const held = await fixture();
  held.get('title').value = 'Too long'; held.get('description').value = '';
  held.get('image').value = ''; held.get('duration-unit').value = 'days'; held.get('duration').value = '8'; held.get('starting').value = '100';
  held.get('increment').value = '100'; held.get('reserve').value = '0';
  await held.get('create-form').onsubmit({ preventDefault() {} }); await settle();
  assert.equal(held.calls.listingSigns, 0); assert.equal(held.calls.authorizations.length, 0);
  assert.match(held.get('duration').validationMessage, /between 3 seconds and 1 hour/);
  assert.match(held.get('duration-error').textContent, /between 3 seconds and 1 hour/);
  assert.match(held.get('message').textContent, /between 3 seconds and 1 hour/);
});

test('a queued bid stops after committed-state loss while exact retained imports still complete', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const gate = deferred(); held.gateNextImport(gate);
  const importsBefore = held.calls.imports;
  const maintenance = held.run('runMaintenance(scope(), { force: true })'); await settle();
  const bidOutcome = held.run('placeBid("a1", 600)').then(() => null, error => error);
  await settle(); assert.equal(held.calls.bids.length, 0);
  held.failState(true);
  const refreshOutcome = held.run('refresh()').then(() => null, error => error);
  await settle(); assert.equal(held.run('state.publicStateAvailable'), false);
  held.calls.importedRefundOperationIds.push('retained-return-during-queued-bid');
  gate.resolve();
  const bidError = await bidOutcome, refreshError = await refreshOutcome;
  await maintenance;
  assert.equal(held.calls.bids.length, 0, 'no new funded operation may start after public-state loss');
  assert.match(bidError?.message || '', /New operations are paused until committed auction and wallet state are available again/);
  assert.match(refreshError?.message || '', /committed state unavailable/);
  assert.ok(held.calls.imports >= importsBefore + 2, 'outage recovery must still run exact retained maintenance');
  assert.equal(held.run(`state.importedReturnOperations.has('retained-return-during-queued-bid')`), true);
  assert.equal(held.calls.authorizations.length, 0);
  assert.equal(held.calls.listingSigns, 0);
  held.failState(false);
  await held.run('refresh()');
  await held.run('placeBid("a1", 600)');
  assert.equal(held.calls.bids.length, 1, 'a transient gate rejection must release the exclusive maintenance slot');
});

test('a queued bid rechecks runtime readiness after maintenance releases', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const gate = deferred(); held.gateNextImport(gate);
  const maintenance = held.run('runMaintenance(scope(), { force: true })'); await settle();
  const bidOutcome = held.run('placeBid("a1", 600)').then(() => null, error => error);
  await settle(); assert.equal(held.calls.bids.length, 0);
  held.readiness(false); await held.run('state.readinessNextAt=0; refreshReadiness()');
  gate.resolve(); const error = await bidOutcome; await maintenance;
  assert.equal(held.calls.bids.length, 0);
  assert.match(error?.message || '', /admission path is not active/);
});

test('a queued bid rechecks the latest committed auction before funding', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const gate = deferred(); held.gateNextImport(gate);
  const maintenance = held.run('runMaintenance(scope(), { force: true })'); await settle();
  const bidOutcome = held.run('placeBid("a1", 600)').then(() => null, error => error);
  await settle(); assert.equal(held.calls.bids.length, 0);
  held.view.state.auctions.a1.status = 'closed';
  const refresh = held.run('refresh()'); await settle();
  assert.equal(held.run('state.view.state.auctions.a1.status'), 'closed');
  gate.resolve(); const error = await bidOutcome; await maintenance; await refresh;
  assert.equal(held.calls.bids.length, 0);
  assert.match(error?.message || '', /Auction is not open in committed state/);
});

test('a queued bid rechecks the latest minimum and leader before creating a funded operation', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const gate = deferred(); held.gateNextImport(gate);
  const maintenance = held.run('runMaintenance(scope(), { force: true })'); await settle();
  const bidOutcome = held.run('placeBid("a1", 600)').then(() => null, error => error);
  await settle(); assert.equal(held.calls.bids.length, 0);
  held.view.state.auctions.a1.high_bid = 600; held.view.state.auctions.a1.leader_bid_id = 'new-leader';
  held.view.state.bids['new-leader'] = { id: 'new-leader', auction_id: 'a1', bidder: otherActor, amount: 600, committed_at: 4 };
  const refresh = held.run('refresh()'); await settle();
  gate.resolve(); const error = await bidOutcome; await maintenance;
  await refresh;
  assert.equal(held.calls.bids.length, 0);
  assert.match(error?.message || '', /Bid must be at least 700 fake sats/);
});

test('a queued bid rechecks policy and committed consensus time before funding', async () => {
  const policy = await fixture({ auctionSeller: otherActor });
  const policyGate = deferred(); policy.gateNextImport(policyGate);
  const policyMaintenance = policy.run('runMaintenance(scope(), { force: true })'); await settle();
  const policyOutcome = policy.run('placeBid("a1", 600)').then(() => null, error => error);
  await settle(); policy.run('state.config.auction_payment_policy.max_bid_amount = 500');
  policyGate.resolve(); const policyError = await policyOutcome; await policyMaintenance;
  assert.equal(policy.calls.bids.length, 0);
  assert.match(policyError?.message || '', /reviewed auction payment policy is unavailable/);

  const timing = await fixture({ auctionSeller: otherActor });
  const timingGate = deferred(); timing.gateNextImport(timingGate);
  const timingMaintenance = timing.run('runMaintenance(scope(), { force: true })'); await settle();
  const timingOutcome = timing.run('placeBid("a1", 600)').then(() => null, error => error);
  await settle(); timing.view.state.last_consensus_time = timing.view.state.auctions.a1.end_time;
  const timingRefresh = timing.run('refresh()'); await settle();
  timingGate.resolve(); const timingError = await timingOutcome; await timingMaintenance;
  await timingRefresh;
  assert.equal(timing.calls.bids.length, 0);
  assert.match(timingError?.message || '', /bidding has ended in committed consensus time/);
});

test('a transient bid callback rejection cannot block exact retained recovery during a public outage', async () => {
  const bidGate = deferred();
  const held = await fixture({ auctionSeller: otherActor, bidGate });
  held.calls.bidFailures = 1;
  const bidOutcome = held.run('placeBid("a1", 600)').then(() => null, error => error);
  await settle(); assert.equal(held.calls.bids.length, 1);
  held.failState(true);
  const refreshOutcome = held.run('refresh()').then(() => null, error => error);
  await settle(); assert.equal(held.run('state.publicStateAvailable'), false);
  held.calls.importedRefundOperationIds.push('retained-return-after-callback-rejection');
  bidGate.resolve();
  const bidError = await bidOutcome, refreshError = await refreshOutcome;
  assert.match(bidError?.message || '', /transient bid callback failed/);
  assert.match(refreshError?.message || '', /committed state unavailable/);
  assert.equal(held.run(`state.importedReturnOperations.has('retained-return-after-callback-rejection')`), true);
  assert.match(held.get('message').textContent, /exact retained payment recovery remains available/);
  assert.doesNotMatch(held.get('message').textContent, /recovery also failed/i);
});

test('a genuine retained-recovery failure remains an error and never shows the availability warning', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  held.calls.importFailures = 1;
  held.failState(true);
  const error = await held.run('refresh()').then(() => null, value => value);
  assert.match(error?.message || '', /Retained payment recovery also failed/);
  assert.match(held.get('message').textContent, /Retained payment recovery also failed/);
  assert.doesNotMatch(held.get('message').textContent, /exact retained payment recovery remains available/);
  assert.equal(held.get('message').dataset.tone, 'error');
});

test('a queued forced import does not retry a failed forced import or bypass its backoff', async () => {
  const held = await fixture({ auctionSeller: otherActor });
  const gate = deferred(); held.gateNextImport(gate); held.calls.importFailures = 1;
  const importsBefore = held.calls.imports;
  const first = held.run('runMaintenance(scope(), { force: true })').then(() => null, error => error);
  await settle();
  const second = held.run('runMaintenance(scope(), { force: true })').then(() => null, error => error);
  await settle(); gate.resolve();
  const [firstError, secondError] = await Promise.all([first, second]);
  assert.match(firstError?.message || '', /terminal transport unavailable/);
  assert.match(secondError?.message || '', /terminal transport unavailable/);
  assert.equal(held.calls.imports, importsBefore + 1, 'the queued waiter must not immediately repeat the failed forced import');
  assert.equal(held.run('state.maintenanceNextAt - readinessNow()'), 15000);
});
