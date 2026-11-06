const ui = window.PlebeianUI;
const state = {
  actor: "", signer: null, identityMode: "", config: null, releasePins: null, friday: null,
  view: null, wallet: null, validators: null, query: "", generation: 0,
  refreshPromise: null, maintenancePromise: null, actionKeys: new Set(), lastPresentation: "",
  readinessPromise: null, readinessNextAt: 0, readinessFailures: 0,
  maintenanceNextAt: 0, maintenanceFailures: 0,
  bidDrafts: new Map(), expiredPrelockBids: [], auctionPayoutAvailability: new Map(),
};
const byId = (id) => document.getElementById(id);
const short = (value) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
const exactInteger = (value, name, minimum = 1) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${name} must be a safe whole number of at least ${minimum}.`);
  return number;
};

async function api(path, options = {}) {
  const response = await fetch(path, { redirect: "error", credentials: "same-origin", ...options,
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) } });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (type !== "application/json") throw new Error(`Unexpected response type from ${path}.`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function message(text, tone = "info") { const target = byId("message"); target.textContent = text; target.dataset.tone = tone; }
function el(tag, className = "", content = "") { const node = document.createElement(tag); if (className) node.className = className; if (content) node.textContent = content; return node; }
function empty(title, detail) { const node = el("div", "empty-state"); node.append(el("strong", "", title), el("span", "", detail)); return node; }
function scope() { return ui.scopeKey(state.actor, state.releasePins?.deployment_id || ""); }
function r20Pins(config) { return {
  environmentId: config.deployment_id, authNetworkId: config.auth_network_id, chainId: config.chain_id,
  genesisSha256: config.genesis_sha256, canonicalMintUrl: config.cashu_mint_url,
  committeeKeysetId: config.committee_keyset_id, committeeKeysetVersion: config.committee_keyset_version,
  dkgRunId: config.dkg_run_id, committeePublicKey: config.committee_public_key,
  publicKeyPackageSha256: config.public_key_package_sha256, signerRosterDigest: config.signer_roster_digest,
  fakeFundingPolicyDigest: config.fake_funding_policy_digest,
}; }
function readinessNow() { return typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now(); }
function r20RuntimeReady(config = state.config) {
  return config?.threshold_custody === true && config.browser_threshold_wallet_ready === true
    && config.browser_threshold_admission_ready === true && config.recovery_only === false;
}
function invalidateReadinessIdentity() {
  state.generation += 1;
  // Retire the controller without discarding a tab-local private identity.
  state.actor = ""; state.friday = null; state.wallet = null; state.expiredPrelockBids = [];
  state.maintenanceNextAt = 0; state.maintenanceFailures = 0;
  byId("actor").textContent = "Disconnected";
}
function readinessIdentityError() {
  const error = new Error("The independently pinned release identity changed or could not be verified. Reconnect after configuration is restored.");
  error.identityFault = true; return error;
}
function validateReadinessPins(pins) {
  if (!pins || pins.schema !== "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1") throw readinessIdentityError();
  const values = r20Pins(pins), id = /^[A-Za-z0-9_-]{1,160}$/, hash = /^[0-9a-f]{64}$/;
  for (const key of ["environmentId", "authNetworkId", "chainId", "committeeKeysetId", "committeeKeysetVersion", "dkgRunId"]) {
    if (typeof values[key] !== "string" || !id.test(values[key])) throw readinessIdentityError();
  }
  for (const key of ["genesisSha256", "publicKeyPackageSha256", "signerRosterDigest", "fakeFundingPolicyDigest"]) {
    if (typeof values[key] !== "string" || !hash.test(values[key])) throw readinessIdentityError();
  }
  if (typeof values.committeePublicKey !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(values.committeePublicKey)
    || typeof values.canonicalMintUrl !== "string" || !/^https:\/\/[^/?#@]+$/.test(values.canonicalMintUrl)) throw readinessIdentityError();
  return pins;
}
async function refreshReadiness() {
  if (state.readinessPromise) return state.readinessPromise;
  const now = readinessNow();
  if (now < state.readinessNextAt) return r20RuntimeReady() && Boolean(state.releasePins);
  state.readinessPromise = (async () => {
    const abort = new AbortController(); let timer;
    const wasReady = r20RuntimeReady();
    try {
      const [config, pins] = await Promise.race([
        Promise.all([api("/api/config", { signal: abort.signal }), api("/api/browser-release-pins", { signal: abort.signal })]),
        new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error("Runtime readiness check timed out.")); }, 8000); }),
      ]);
      validateReadinessPins(pins);
      const runtimePins = r20Pins({ ...config, fake_funding_policy_digest: config?.fake_funding_policy?.digest });
      if (JSON.stringify(runtimePins) !== JSON.stringify(r20Pins(pins))) throw readinessIdentityError();
      const identityChanged = state.releasePins && JSON.stringify(r20Pins(state.releasePins)) !== JSON.stringify(r20Pins(pins));
      const ready = r20RuntimeReady(config);
      if (identityChanged) invalidateReadinessIdentity();
      else if (wasReady && !ready) state.maintenanceNextAt = 0;
      state.config = config; state.releasePins = pins;
      // Valid false can be backend warmup, not a transport failure. Keep two
      // observations inside its continuity window, even after slow collection.
      // Start-based spacing caps request rate without adding response latency.
      state.readinessFailures = 0;
      state.readinessNextAt = now + 4000;
      updateControls();
      if (wasReady && !ready) message("New operations paused while runtime dependencies recover. Existing payment imports retain their normal safety checks.", "warning");
      else if (!wasReady && ready) message("Runtime ready. Connect an identity or continue.", "success");
      return ready;
    } catch (error) {
      if (error.identityFault) invalidateReadinessIdentity();
      else if (wasReady) state.maintenanceNextAt = 0;
      state.config = { ...state.config, browser_threshold_wallet_ready: false, browser_threshold_admission_ready: false };
      state.readinessFailures = Math.min(state.readinessFailures + 1, 4);
      state.readinessNextAt = readinessNow() + Math.min(30000, 4000 * 2 ** (state.readinessFailures - 1));
      updateControls(); message(error.message, "warning"); return false;
    } finally { clearTimeout(timer); abort.abort(); }
  })().finally(() => { state.readinessPromise = null; });
  return state.readinessPromise;
}

function requireR20Ready() {
  if (!r20RuntimeReady() || !state.releasePins) throw new Error("The reviewed R20 browser wallet and admission path is not active. Refresh or retry after runtime recovery.");
}

async function connectFridayController(signer) {
  await refreshReadiness(); requireR20Ready();
  if (!window.plebeianFridayR20Connect) throw new Error("The reviewed R20 browser connector did not load.");
  if (!state.releasePins) throw new Error("The independently release-pinned R20 manifest is unavailable.");
  return window.plebeianFridayR20Connect({ signer, pins: r20Pins(state.releasePins) });
}
async function installSigner(signer, mode) {
  await refreshReadiness(); requireR20Ready();
  disconnect();
  const generation = state.generation;
  const actor = await signer.getPublicKey();
  // NIP-07 getPublicKey is an explicit permission boundary in common browser
  // extensions. Consent once for this connected session instead of prompting
  // again on every four-second wallet refresh. Every signed event still goes
  // to the extension and the browser controller verifies its exact actor and
  // immutable fields, so an account change remains fail-closed on mutation.
  const sessionSigner = Object.freeze({
    getPublicKey: async () => actor,
    signEvent: (event) => signer.signEvent(event),
  });
  const friday = await connectFridayController(sessionSigner);
  if (generation !== state.generation) return;
  state.actor = actor; state.signer = sessionSigner; state.identityMode = mode; state.friday = friday; state.wallet = null;
  byId("actor").textContent = `${mode} · ${short(actor)}`;
  const pending = await friday.pendingFakeFunding();
  if (generation !== state.generation) return;
  if (pending) {
    byId("faucet-amount").value = String(pending.amount);
    message(`Recovered unresolved funding ${short(pending.operationId)}. Retry only its original ${ui.formatSats(pending.amount)} fake sats.`, "warning");
  }
  updateControls();
  await refresh();
}
async function connect() {
  if (!window.nostr?.getPublicKey || !window.nostr?.signEvent) throw new Error("A NIP-07 signer is required; this site never requests its private key.");
  await installSigner(window.nostr, "NIP-07");
}
async function connectDemo() {
  if (!window.plebeianCreateDemoSigner) throw new Error("The disposable demo signer did not load.");
  const retained = !state.friday && !state.actor && state.identityMode === "tab-local demo signer" ? state.signer : null;
  await installSigner(retained || window.plebeianCreateDemoSigner(), "tab-local demo signer");
  message(retained ? "Reconnected this tab's existing demo identity. Reloading still loses its key."
    : "Created a fresh tab-local Nostr identity. Reloading loses this demo key; use NIP-07 for durable identity.", "warning");
}
function disconnect() {
  state.generation += 1;
  state.bidDrafts.clear(); state.auctionPayoutAvailability.clear();
  state.actor = ""; state.signer = null; state.friday = null; state.wallet = null; state.identityMode = ""; state.expiredPrelockBids = [];
  state.maintenanceNextAt = 0; state.maintenanceFailures = 0;
  byId("actor").textContent = "Disconnected"; updateControls();
}

async function sign(kind, tags, content) {
  if (!state.actor || !state.signer) throw new Error("Connect a Nostr signer first.");
  return state.signer.signEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify(content) });
}
function updateControls() {
  const connectReady = Boolean(state.releasePins && r20RuntimeReady());
  const ready = Boolean(state.actor && state.friday && connectReady);
  byId("login").disabled = !connectReady;
  byId("demo-login").disabled = !connectReady;
  byId("faucet").disabled = !ready;
  byId("process-payments").disabled = !ready;
  byId("disconnect").disabled = !state.signer;
  byId("create-submit").disabled = !ready;
  const policy = state.config?.fake_funding_policy;
  if (policy) {
    byId("faucet-amount").max = String(policy.max_per_request);
    byId("faucet-help").textContent = `Per request: 1–${ui.formatSats(policy.max_per_request)}. Browser-wallet advisory resulting balance: ${ui.formatSats(policy.max_resulting_balance)}. Mint-wide and ingress controls are separate.`;
  }
}

async function runMaintenance(capturedScope, { force = false } = {}) {
  if (!state.friday || !capturedScope) return { refunds: 0, winnerPayments: 0 };
  if (state.maintenancePromise) {
    const prior = await state.maintenancePromise;
    if (!force) return prior;
  }
  const now = readinessNow();
  if (!force && now < state.maintenanceNextAt) return { refunds: 0, winnerPayments: 0 };
  const controller = state.friday;
  state.maintenancePromise = (async () => {
    try {
      const imported = await controller.importAvailable();
      if (capturedScope !== scope()) throw new Error("Signer or deployment changed during wallet maintenance.");
      state.maintenanceFailures = 0;
      state.maintenanceNextAt = readinessNow() + 15000;
      if (imported.refunds || imported.winnerPayments) {
        message(`Imported ${imported.refunds} certified outbid return(s) and ${imported.winnerPayments} seller payout(s).`, "success");
      }
      return imported;
    } catch (error) {
      state.maintenanceFailures = Math.min(state.maintenanceFailures + 1, 4);
      state.maintenanceNextAt = readinessNow() + Math.min(120000, 15000 * 2 ** (state.maintenanceFailures - 1));
      if (force) throw error;
      return { refunds: 0, winnerPayments: 0 };
    }
  })().finally(() => { state.maintenancePromise = null; });
  return state.maintenancePromise;
}
async function runExclusiveMaintenance(capturedScope, operation) {
  while (state.maintenancePromise) {
    await state.maintenancePromise.catch(() => undefined);
  }
  if (capturedScope !== scope()) throw new Error("Signer or deployment changed before wallet maintenance.");
  const controller = state.friday;
  if (!controller) throw new Error("Connect a signer first.");
  state.maintenancePromise = (async () => operation(controller))()
    .finally(() => { state.maintenancePromise = null; });
  return state.maintenancePromise;
}
async function refresh() {
  if (state.refreshPromise) return state.refreshPromise;
  const generation = state.generation, capturedScope = scope();
  state.refreshPromise = (async () => {
    await refreshReadiness();
    const suffix = state.actor ? `?actor=${encodeURIComponent(state.actor)}` : "";
    const [view, validators] = await Promise.all([api(`/api/state${suffix}`), api("/api/validators")]);
    if (generation !== state.generation || capturedScope !== scope()) return;
    state.view = view; state.validators = validators;
    if (state.actor && state.friday) {
      const controller = state.friday;
      const currentActor = await controller.actor();
      if (generation !== state.generation || controller !== state.friday) return;
      if (currentActor !== state.actor) { disconnect(); message("Signer account changed. Reconnect before continuing.", "warning"); render(); return; }
      await runMaintenance(capturedScope);
      if (!state.maintenancePromise) {
        const balance = await runExclusiveMaintenance(capturedScope, (held) => held.balance());
        if (generation !== state.generation || capturedScope !== scope()) return;
        state.wallet = balance;
      }
      const ownedOpenAuctions = Object.values(state.view?.state?.auctions || {})
        .filter((auction) => auction.status === "open" && auction.seller === state.actor);
      const retained = new Set(ownedOpenAuctions.map((auction) => auction.id));
      for (const id of state.auctionPayoutAvailability.keys()) {
        if (!retained.has(id)) state.auctionPayoutAvailability.delete(id);
      }
      await Promise.all(ownedOpenAuctions.map(async (auction) => {
        if (state.auctionPayoutAvailability.get(auction.id) === "ready") return;
        try {
          const payout = await controller.readAuctionPayout(auction.id);
          if (generation !== state.generation || controller !== state.friday) return;
          state.auctionPayoutAvailability.set(auction.id, payout === null ? "missing" : "ready");
        } catch {
          if (generation === state.generation && controller === state.friday) state.auctionPayoutAvailability.set(auction.id, "unknown");
        }
      }));
    } else state.wallet = null;
    render();
  })().catch((error) => { message(error.message, "error"); throw error; }).finally(() => { state.refreshPromise = null; });
  return state.refreshPromise;
}

async function refreshCommittedAuction(auctionId, minimumHeight, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (state.refreshPromise) await state.refreshPromise.catch(() => undefined);
    await refresh();
    const height = Number(state.view?.state?.height);
    const auction = state.view?.state?.auctions?.[auctionId];
    if (Number.isSafeInteger(height) && height >= minimumHeight && auction) return auction;
  }
  return null;
}

function renderWallet() {
  const wallet = state.wallet, target = byId("notes"); target.replaceChildren();
  byId("spendable").textContent = wallet ? ui.formatSats(wallet.available) : "—";
  byId("locked").textContent = wallet ? ui.formatSats(wallet.reserved + wallet.locked) : "—";
  byId("refundable").textContent = wallet ? ui.formatSats(wallet.pending + wallet.unresolved) : "—";
  if (!wallet) { target.append(empty("Connect an identity", "The threshold wallet remains fail-closed until an exact signer and release are connected.")); return; }
  const card = el("div", "note");
  card.append(el("strong", "", `${ui.formatSats(wallet.available)} spendable fake sats`),
    el("small", "", `${ui.formatSats(wallet.reserved)} reserved · ${ui.formatSats(wallet.locked)} locked`),
    el("small", "", `${ui.formatSats(wallet.pending)} pending · ${ui.formatSats(wallet.unresolved)} unresolved`),
    el("small", "receipt", `Actor ${short(state.actor)} · ${state.identityMode}`));
  target.append(card);
  const review = el("button", "button button-secondary", "Review expired bid intents");
  review.type = "button"; review.disabled = !state.friday || state.actionKeys.has("review-expired-prelock");
  review.onclick = () => performAction("review-expired-prelock", review, "Checking…", async () => {
    requireR20Ready();
    const controller = state.friday, captured = scope();
    if (!controller) throw new Error("Connect a signer first.");
    const pending = await runExclusiveMaintenance(captured, (held) => held.expiredPrelockPending());
    if (controller !== state.friday || captured !== scope()) throw new Error("Signer or deployment changed during recovery review.");
    state.expiredPrelockBids = pending; renderWallet();
    message(pending.length ? `${pending.length} expired pre-lock bid intent(s) need review.` : "No expired pre-lock bid intents were found.", pending.length ? "warning" : "success");
  }).catch(() => undefined);
  target.append(review);
  for (const pending of state.expiredPrelockBids) {
    const recovery = el("div", "note");
    recovery.append(el("strong", "", `Expired bid intent · ${ui.formatSats(pending.bidAmount)}`),
      el("small", "", `Auction ${pending.auctionId} · expired ${ui.formatTime(pending.expiresAt)}`),
      el("small", "receipt", `Operation ${pending.fundingOperationId}`));
    const discard = el("button", "button button-secondary", "Discard pre-lock intent"); discard.type = "button";
    discard.onclick = () => performAction(`discard-prelock:${pending.fundingOperationId}`, discard, "Verifying…", async () => {
      if (!window.confirm(`Discard expired pre-lock intent ${pending.fundingOperationId} for auction ${pending.auctionId}? This is allowed only if no seller plan, payment lock or cancellation journal exists.`)) return;
      requireR20Ready(); const controller = state.friday, captured = scope();
      if (!controller) throw new Error("Connect a signer first.");
      const result = await runExclusiveMaintenance(captured, (held) => held.discardExpiredPrelockPending(pending.fundingOperationId));
      if (controller !== state.friday || captured !== scope()) throw new Error("Signer or deployment changed during expired intent recovery.");
      state.expiredPrelockBids = state.expiredPrelockBids.filter((entry) => entry.fundingOperationId !== result.fundingOperationId);
      message(`Discarded expired pre-lock intent ${short(result.fundingOperationId)}. The next bid will use a new operation.`, "success");
      await refresh();
    }).catch(() => undefined);
    recovery.append(discard, el("small", "fine-print", "This never cancels a locked bid. If private payment or abort state exists, recovery stops and preserves the operation."));
    target.append(recovery);
  }
}
function participantStatus(auction) {
  if (!state.actor) return { tone: "", title: "Connect to participate", detail: "A Nostr identity and browser-owned Coco wallet are required." };
  if (auction.seller === state.actor) {
    if (auction.status !== "open") return { tone: "leading", title: auction.winner ? "Seller payout eligible" : "Closed without sale", detail: auction.winner ? "Import the certified winner payment into your Coco key." : "No winner payment exists." };
    const payout = state.auctionPayoutAvailability.get(auction.id);
    if (payout === "missing") return { tone: "refund", title: "Offline bidding setup incomplete", detail: "Complete the one-time auction-scoped payout setup; no per-bid seller approval is used." };
    if (payout === "ready") return { tone: "", title: "You are the seller", detail: "The auction-scoped payout authorization lets bidders bid while you are offline." };
    return { tone: "", title: "You are the seller", detail: "Checking the auction-scoped offline bidding authorization." };
  }
  const bids = Object.values(state.view?.state?.bids || {}).filter((bid) => bid.auction_id === auction.id && bid.bidder === state.actor).sort((a,b) => b.committed_at-a.committed_at);
  const latest = bids[0], leading = auction.leader_bid_id && state.view?.state?.bids?.[auction.leader_bid_id]?.bidder === state.actor;
  if (auction.status === "closed" && auction.winner === state.actor) return { tone: "leading", title: "You won", detail: "Consensus selected this identity. The seller receives the winning amount." };
  if (latest && leading && auction.status === "open") return { tone: "leading", title: "You are leading", detail: `${ui.formatSats(auction.high_bid)} fake sats remain in the exact funded pool.` };
  if (latest && !leading) return { tone: "refund", title: "Outbid return pending or imported", detail: "Automatic import rechecks the certified terminal return on refresh." };
  return { tone: "", title: "Ready to bid", detail: "The next bid uses a fresh exact threshold-funded pool." };
}
function renderAuctions() {
  const target = byId("auctions"), all = Object.values(state.view?.state?.auctions || {}).sort((a,b) => b.created_at-a.created_at);
  const active = document.activeElement, focusedBid = active?.dataset?.auctionBidId ? {
    auctionId: active.dataset.auctionBidId,
    start: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
    end: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
    direction: active.selectionDirection || "none",
  } : null;
  let restoreBidFocus = null;
  const draftPrefix = `${scope()}\u0000`;
  const openIds = new Set(all.filter((auction) => auction.status === "open").map((auction) => auction.id));
  for (const key of state.bidDrafts.keys()) {
    if (key.startsWith(draftPrefix) && !openIds.has(key.slice(draftPrefix.length))) state.bidDrafts.delete(key);
  }
  const auctions = ui.filterAuctions(all, state.query); target.replaceChildren(); target.setAttribute("aria-busy", "false");
  byId("market-meta").textContent = `${auctions.length} of ${all.length} committed auction(s) · app height ${state.view?.state?.height ?? "—"}`;
  if (!auctions.length) { target.append(empty("No matching auctions", state.query ? "Clear the search to view all committed auctions." : "Create the first signed auction.")); return; }
  for (const auction of auctions) {
    const card = el("article", "auction"), status = participantStatus(auction), timer = ui.countdown(Number(auction.end_time));
    card.append(el("p", "eyebrow", auction.status.toUpperCase()), el("h3", "", auction.title), el("p", "section-subtitle", `Seller ${short(auction.seller)} · ${timer.label}`));
    const imageSource = ui.imageURL(auction.image_url);
    if (imageSource.ok && imageSource.url) { const image = document.createElement("img"); image.className="auction-image"; image.src=imageSource.url; image.alt="Auction item"; image.loading="lazy"; image.decoding="async"; image.referrerPolicy="no-referrer"; card.append(image); }
    if (auction.description) card.append(el("p", "", auction.description));
    const list = el("dl");
    [["High bid", ui.formatSats(Number(auction.high_bid))],["Increment",ui.formatSats(Number(auction.min_increment))],["Reserve",auction.reserve ? ui.formatSats(Number(auction.reserve)) : "None"],["Ends",ui.formatTime(Number(auction.end_time))],["Extension",`${Math.max(0,Number(auction.end_time)-Number(auction.original_end_time))}s`],["Winner",short(auction.winner)]].forEach(([key,value]) => list.append(el("dt","",key),el("dd","",String(value))));
    card.append(list, el("div", `status-card ${status.tone}`, "")); card.lastChild.append(el("strong","",status.title),el("small","",status.detail));
    const actions = el("div", "actions");
    if (auction.status === "open" && state.actor && auction.seller !== state.actor) {
      const minimum = ui.minimumBid(auction), label = document.createElement("label"), input = document.createElement("input");
      const draftKey = `${scope()}\u0000${auction.id}`;
      label.append(el("span","field-help","Bid amount")); input.type="text"; input.pattern="[0-9]*"; input.autocomplete="off"; input.spellcheck=false; input.inputMode="numeric"; input.dataset.auctionBidId=auction.id; input.value=state.bidDrafts.get(draftKey) || ""; label.append(input);
      const validate = () => { const parsed = ui.bidAmount(input.value, minimum); state.bidDrafts.set(draftKey, input.value); input.setCustomValidity?.(parsed.ok ? "" : parsed.reason); input.setAttribute("aria-invalid", String(input.value !== "" && !parsed.ok)); };
      input.oninput=validate; validate();
      const button = el("button","button button-primary","Authorize funded bid"); button.type="button"; button.disabled = minimum === null || !state.friday || !r20RuntimeReady(); button.onclick=()=>performAction(`bid:${auction.id}`,button,"Authorizing…",async()=>{const parsed=ui.bidAmount(input.value,minimum);if(!parsed.ok)throw new Error(parsed.reason);await placeBid(auction.id,parsed.amount);state.bidDrafts.delete(draftKey);});
      if (focusedBid?.auctionId === auction.id) restoreBidFocus = input;
      actions.append(label,button);
    }
    if (auction.status === "open" && auction.seller === state.actor
      && state.auctionPayoutAvailability.get(auction.id) === "missing") {
      const setup = el("button", "button button-secondary", "Complete offline bidding setup");
      setup.type = "button";
      setup.onclick = () => performAction(`auction-payout:${auction.id}`, setup, "Authorizing…", async () => {
        await authorizeCommittedAuctionPayout(auction);
        message(`Offline bidding is ready for auction ${auction.id}; bidders no longer need this seller tab.`, "success");
        renderAuctions();
        await refresh();
      }).catch(() => undefined);
      actions.append(setup);
    }
    if (auction.status === "open") actions.append(el("small","fine-print",timer.ended ? "Awaiting the R20 deterministic close trigger and committed closed state." : "Consensus time controls anti-sniping extension and close eligibility."));
    card.append(actions); target.append(card);
  }
  if (restoreBidFocus) {
    restoreBidFocus.focus?.({ preventScroll: true });
    if (focusedBid.start !== null && focusedBid.end !== null && typeof restoreBidFocus.setSelectionRange === "function") {
      const length = restoreBidFocus.value.length;
      restoreBidFocus.setSelectionRange(Math.min(focusedBid.start, length), Math.min(focusedBid.end, length), focusedBid.direction);
    }
  }
}
function renderValidators() {
  const target=byId("validators"), validators=state.validators?.validators || []; target.replaceChildren(); target.setAttribute("aria-busy","false");
  const heights=validators.map((v)=>v.canonical_commit_height).filter(Number.isSafeInteger);
  byId("validator-summary").textContent = `${validators.filter((v)=>v.online).length}/4 signatures observed · canonical commit ${heights.length ? Math.max(...heights) : "—"}`;
  for (const validator of validators) { const evidence=ui.validatorEvidence(validator), card=el("article",`validator ${evidence.state==='observed'?"online":"offline"}`), heading=el("strong"); heading.append(document.createTextNode(`V${validator.slot}`),el("i","dot")); card.append(heading,el("span","",evidence.label),el("small","",evidence.detail),el("small","",`node ${short(validator.node_id)}`),el("small","",`app ${short(validator.app_hash)}`)); target.append(card); }
}
function render() { updateControls(); renderWallet(); renderAuctions(); renderValidators(); }

async function performAction(key, button, pendingLabel, action) {
  if (state.actionKeys.has(key)) return;
  state.actionKeys.add(key); const prior=button?.textContent; if(button){button.disabled=true;button.textContent=pendingLabel;}
  try { return await action(); } catch(error) { message(error.message,"error"); throw error; }
  finally { state.actionKeys.delete(key); if(button){button.textContent=prior;updateControls();} }
}
async function placeBid(auctionId, amount) {
  requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first.");
  const auction=state.view?.state?.auctions?.[auctionId]; if(!auction||auction.status!=="open") throw new Error("Auction is not open in committed state.");
  const leader=auction.leader_bid_id?state.view?.state?.bids?.[auction.leader_bid_id]:null; if(leader?.bidder===state.actor) throw new Error("Own raises remain fail-closed until full-pool key continuity is proven.");
  const maximumEnd=Number(auction.original_end_time)+1800;
  const result=await state.friday.placeBid({auctionId,bidAmount:amount,fullPoolAmount:amount,reservedPoolAmount:amount,replacesBidId:auction.leader_bid_id||"",locktime:maximumEnd+900});
  message(result.status==="seller_plan_pending"
    ? `This auction has no registered offline payout authorization. Bid ${short(result.fundingOperationId)} remains pre-lock and cannot proceed.`
    : `Threshold bid ${result.status}${result.committedHeight?` at height ${result.committedHeight}`:""}.`,result.status==="unknown"||result.status==="seller_plan_pending"?"warning":"success"); await refresh();
}
async function authorizeCommittedAuctionPayout(auction) {
  requireR20Ready(); if (!state.friday) throw new Error("Connect a signer first.");
  if (!auction || auction.status !== "open" || auction.seller !== state.actor) throw new Error("Connect the open auction's seller first.");
  const startingBid = exactInteger(auction.starting_bid, "Starting bid");
  const minIncrement = exactInteger(auction.min_increment, "Minimum increment");
  const reserve = exactInteger(auction.reserve, "Reserve", 0);
  const originalEndTime = exactInteger(auction.original_end_time, "Original end time");
  const existing = await state.friday.readAuctionPayout(auction.id);
  if (existing === null) {
    const maximumEndTime = originalEndTime + 1800;
    await state.friday.authorizeAuctionPayout({ auctionId: auction.id, startingBid, minIncrement, reserve,
      originalEndTime, maximumEndTime, maximumPayout: 50000, validUntil: maximumEndTime + 900 });
  }
  state.auctionPayoutAvailability.set(auction.id, "ready");
}
async function servicePayments() {
  requireR20Ready(); if (!state.friday) throw new Error("Connect a signer first.");
  await runMaintenance(scope(), { force: true });
  await refresh();
}

byId("login").onclick=()=>connect().catch((error)=>message(error.message,"error"));
byId("disconnect").onclick=()=>{disconnect();render();message("Disconnected. Reconnect to recover returns and payouts.");};
byId("demo-login").onclick=()=>connectDemo().catch((error)=>message(error.message,"error"));
byId("refresh").onclick=()=>refresh().catch(()=>undefined);
byId("auction-search").oninput=(event)=>{state.query=event.target.value;renderAuctions();};
byId("faucet").onclick=(event)=>performAction("fund",event.currentTarget,"Funding…",async()=>{
  requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first.");
  const policy=state.friday.fundingPolicy(), parsed=ui.fundingAmount(byId("faucet-amount").value,policy.maxPerRequest); if(!parsed.ok) throw new Error(parsed.reason);
  const pending=await state.friday.pendingFakeFunding(); if(pending&&(pending.amount!==parsed.amount||pending.policyDigest!==policy.digest)) throw new Error(`Unresolved funding ${short(pending.operationId)} must retry its original amount and policy.`);
  const result=await state.friday.fundFake(parsed.amount); message(`${ui.formatSats(parsed.amount)} fake sats finalized in Coco (${short(result.operationId)}).`,"success"); byId("faucet-amount").value=""; await refresh();
}).catch(()=>undefined);
byId("process-payments").onclick=(event)=>performAction("maintenance",event.currentTarget,"Importing…",servicePayments).catch(()=>undefined);
byId("create-form").onsubmit=(event)=>{event.preventDefault();return performAction("create",byId("create-submit"),"Signing…",async()=>{
  requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first.");
  const duration=exactInteger(byId("duration").value,"Duration",3),starting=exactInteger(byId("starting").value,"Starting bid"),increment=exactInteger(byId("increment").value,"Minimum increment"),reserve=byId("reserve").value.trim()===""?0:exactInteger(byId("reserve").value,"Reserve",0);
  const image=ui.imageURL(byId("image").value); if(!image.ok) throw new Error(image.reason);
  if(duration>3600) throw new Error("Duration may not exceed 3,600 seconds."); const sellerPaymentPublicKey=await state.friday.sellerPaymentPublicKey();
  const id=`auction-${Date.now()}`; const signed=await sign(28640,[["t","plebeian-auctions-poc"],["auction",id]],{auction_id:id,title:byId("title").value,description:byId("description").value,image_url:image.url,duration_seconds:duration,starting_bid:starting,min_increment:increment,reserve,funding_mode:"threshold_sigall_v1",seller_coco_payment_public_key:sellerPaymentPublicKey});
  const result=await api("/api/event",{method:"POST",body:JSON.stringify(signed)});
  const committed=await refreshCommittedAuction(id,result.height);
  if(!committed||committed.status!=="open"||committed.seller!==state.actor
    ||committed.starting_bid!==starting||committed.min_increment!==increment||committed.reserve!==reserve){
    throw new Error("Committed auction differs from the signed listing; offline payout authorization was not created.");
  }
  await authorizeCommittedAuctionPayout(committed);
  message(`Auction committed at height ${result.height}. One auction-scoped payout authorization now covers bids while the seller is offline.`,"success");
  byId("create-form").reset(); await refresh();
}).catch(()=>undefined);};

(async function boot(){
  try { await refresh(); }
  catch(error){message(error.message,"error");updateControls();}
})();
setInterval(()=>refresh().catch(()=>undefined),4000);
setInterval(()=>{if(state.view)renderAuctions();},1000);
