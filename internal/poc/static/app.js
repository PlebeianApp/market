const ui = window.PlebeianUI;
const state = {
  actor: "", signer: null, identityMode: "", config: null, releasePins: null, friday: null,
  view: null, wallet: null, validators: null, query: "", generation: 0,
  refreshPromise: null, maintenancePromise: null, actionKeys: new Set(), lastPresentation: "",
  readinessPromise: null, readinessNextAt: 0, readinessFailures: 0,
  sellerAuctions: new Set(), approvalRevision: 0, approvalAbort: null,
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
function revokeReadinessConsent() {
  // The accepted seller UI owns consent/cancellation and wallet serialization.
  if (typeof stopSellerApprovals === "function") stopSellerApprovals("Runtime readiness changed. Review the auction and opt in again.");
}
function invalidateReadinessIdentity() {
  revokeReadinessConsent(); state.generation += 1;
  // Retire the controller without discarding a tab-local private identity.
  state.actor = ""; state.friday = null; state.wallet = null;
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
      else if (wasReady !== ready) revokeReadinessConsent();
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
      else if (wasReady) revokeReadinessConsent();
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
  state.signer = signer; state.identityMode = mode;
  const actor = await signer.getPublicKey();
  const friday = await connectFridayController(signer);
  if (generation !== state.generation) return;
  state.actor = actor; state.friday = friday; state.wallet = null;
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
function stopSellerApprovals(detail = "Seller approvals are off. Use an auction's opt-in or the manual button.") {
  state.approvalRevision += 1;
  state.approvalAbort?.abort(); state.approvalAbort = null;
  state.sellerAuctions.clear();
  byId("seller-approval-status").textContent = detail;
}
function disconnect() {
  stopSellerApprovals(); state.generation += 1;
  state.actor = ""; state.signer = null; state.friday = null; state.wallet = null; state.identityMode = "";
  byId("actor").textContent = "Disconnected"; updateControls();
}
function toggleSellerApprovals(auctionId) {
  requireR20Ready();
  const auction = state.view?.state?.auctions?.[auctionId];
  if (!state.friday || auction?.seller !== state.actor || auction.status !== "open") throw new Error("Connect the auction's seller first.");
  // A changed selection never revives an in-flight attempt, even if toggled back.
  state.approvalRevision += 1; state.approvalAbort?.abort(); state.approvalAbort = null;
  if (state.sellerAuctions.has(auctionId)) state.sellerAuctions.delete(auctionId);
  else state.sellerAuctions.add(auctionId);
  byId("seller-approval-status").textContent = state.sellerAuctions.size
    ? `Approvals enabled for ${state.sellerAuctions.size} selected auction(s), actor ${short(state.actor)}, deployment ${state.releasePins.deployment_id}. Each bid still needs the signer's consent. Keep this tab open.`
    : "Seller approvals stopped. Pending returns and payouts still import automatically.";
  renderAuctions();
  void serviceSellerApprovals(false);
}

async function sign(kind, tags, content) {
  if (!state.actor || !state.signer) throw new Error("Connect a Nostr signer first.");
  return state.signer.signEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify(content) });
}
function updateControls() {
  const ready = Boolean(state.actor && state.friday && state.releasePins && r20RuntimeReady());
  byId("faucet").disabled = !ready;
  byId("process-payments").disabled = !ready;
  byId("disconnect").disabled = !state.signer;
  byId("stop-seller-approvals").disabled = !state.approvalAbort && state.sellerAuctions.size === 0;
  byId("create-submit").disabled = !ready;
  const policy = state.config?.fake_funding_policy;
  if (policy) {
    byId("faucet-amount").max = String(policy.max_per_request);
    byId("faucet-help").textContent = `Per request: 1–${ui.formatSats(policy.max_per_request)}. Browser-wallet advisory resulting balance: ${ui.formatSats(policy.max_resulting_balance)}. Mint-wide and ingress controls are separate.`;
  }
}

async function runMaintenance(capturedScope) {
  if (!state.friday || !capturedScope) return { refunds: 0, winnerPayments: 0 };
  if (state.maintenancePromise) return { refunds: 0, winnerPayments: 0 };
  const controller = state.friday;
  state.maintenancePromise = (async () => {
    const imported = await controller.importAvailable();
    if (capturedScope !== scope()) throw new Error("Signer or deployment changed during wallet maintenance.");
    if (imported.refunds || imported.winnerPayments) {
      message(`Imported ${imported.refunds} certified outbid return(s) and ${imported.winnerPayments} seller payout(s).`, "success");
    }
    return imported;
  })().finally(() => { state.maintenancePromise = null; });
  return state.maintenancePromise;
}
async function waitForApproval(signal, read) {
  if (!signal) return read();
  signal.throwIfAborted();
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(new Error("Seller approval cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([read(), cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}
async function runExclusiveMaintenance(capturedScope, operation, signal) {
  while (state.maintenancePromise) {
    await waitForApproval(signal, () => state.maintenancePromise.catch(() => undefined));
  }
  signal?.throwIfAborted();
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
      if (currentActor !== state.actor) { disconnect(); message("Signer account changed. Reconnect and opt in again.", "warning"); render(); return; }
      await runMaintenance(capturedScope);
      // Do not open another wallet while an approval pass owns maintenance.
      // Refresh still renders committed auctions and leaves Stop available.
      if (!state.maintenancePromise) {
        const balance = await runExclusiveMaintenance(capturedScope, (held) => held.balance());
        if (generation !== state.generation || capturedScope !== scope()) return;
        state.wallet = balance;
      }
    } else state.wallet = null;
    render();
    void serviceSellerApprovals(false);
  })().catch((error) => { message(error.message, "error"); throw error; }).finally(() => { state.refreshPromise = null; });
  return state.refreshPromise;
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
}
function participantStatus(auction) {
  if (!state.actor) return { tone: "", title: "Connect to participate", detail: "A Nostr identity and browser-owned Coco wallet are required." };
  if (auction.seller === state.actor) return auction.status === "open"
    ? { tone: "", title: "You are the seller", detail: "Opt in below for bid-plan approvals while this tab stays open, or use the manual payment button." }
    : { tone: "leading", title: auction.winner ? "Seller payout eligible" : "Closed without sale", detail: auction.winner ? "Import the certified winner payment into your Coco key." : "No winner payment exists." };
  const bids = Object.values(state.view?.state?.bids || {}).filter((bid) => bid.auction_id === auction.id && bid.bidder === state.actor).sort((a,b) => b.committed_at-a.committed_at);
  const latest = bids[0], leading = auction.leader_bid_id && state.view?.state?.bids?.[auction.leader_bid_id]?.bidder === state.actor;
  if (auction.status === "closed" && auction.winner === state.actor) return { tone: "leading", title: "You won", detail: "Consensus selected this identity. The seller receives the winning amount." };
  if (latest && leading && auction.status === "open") return { tone: "leading", title: "You are leading", detail: `${ui.formatSats(auction.high_bid)} fake sats remain in the exact funded pool.` };
  if (latest && !leading) return { tone: "refund", title: "Outbid return pending or imported", detail: "Automatic import rechecks the certified terminal return on refresh." };
  return { tone: "", title: "Ready to bid", detail: "The next bid uses a fresh exact threshold-funded pool." };
}
function renderAuctions() {
  const target = byId("auctions"), all = Object.values(state.view?.state?.auctions || {}).sort((a,b) => b.created_at-a.created_at);
  const auctions = ui.filterAuctions(all, state.query); target.replaceChildren(); target.setAttribute("aria-busy", "false");
  byId("market-meta").textContent = `${auctions.length} of ${all.length} committed auction(s) · app height ${state.view?.state?.height ?? "—"}`;
  if (!auctions.length) { target.append(empty("No matching auctions", state.query ? "Clear the search to view all committed auctions." : "Create the first signed auction.")); return; }
  for (const auction of auctions) {
    const card = el("article", "auction"), status = participantStatus(auction), timer = ui.countdown(Number(auction.end_time));
    card.append(el("p", "eyebrow", auction.status.toUpperCase()), el("h3", "", auction.title), el("p", "section-subtitle", `Seller ${short(auction.seller)} · ${timer.label}`));
    if (auction.image_url) { const image = document.createElement("img"); image.className="auction-image"; image.src=auction.image_url; image.alt="Auction item"; image.loading="lazy"; image.referrerPolicy="no-referrer"; card.append(image); }
    if (auction.description) card.append(el("p", "", auction.description));
    const list = el("dl");
    [["High bid", ui.formatSats(Number(auction.high_bid))],["Increment",ui.formatSats(Number(auction.min_increment))],["Reserve",auction.reserve ? ui.formatSats(Number(auction.reserve)) : "None"],["Ends",ui.formatTime(Number(auction.end_time))],["Extension",`${Math.max(0,Number(auction.end_time)-Number(auction.original_end_time))}s`],["Winner",short(auction.winner)]].forEach(([key,value]) => list.append(el("dt","",key),el("dd","",String(value))));
    card.append(list, el("div", `status-card ${status.tone}`, "")); card.lastChild.append(el("strong","",status.title),el("small","",status.detail));
    const actions = el("div", "actions");
    if (auction.status === "open" && state.actor && auction.seller !== state.actor) {
      const minimum = ui.minimumBid(auction), label = document.createElement("label"), input = document.createElement("input");
      label.append(el("span","field-help","Bid amount")); input.type="number"; input.min=String(minimum ?? 1); input.step="1"; input.inputMode="numeric"; label.append(input);
      const button = el("button","button button-primary","Authorize funded bid"); button.type="button"; button.disabled = minimum === null || !state.friday || !r20RuntimeReady(); button.onclick=()=>performAction(`bid:${auction.id}`,button,"Authorizing…",()=>placeBid(auction.id,exactInteger(input.value,"Bid amount",minimum ?? 1)));
      actions.append(label,button);
    }
    if (auction.status === "open" && auction.seller === state.actor) {
      const enabled = state.sellerAuctions.has(auction.id);
      const approval = el("button", "button button-secondary", enabled ? "Stop bid-plan approvals" : "Enable bid-plan approvals for this auction");
      approval.type = "button"; approval.setAttribute("aria-pressed", String(enabled));
      approval.onclick = () => { try { toggleSellerApprovals(auction.id); } catch (error) { message(error.message, "error"); } };
      actions.append(approval, el("small", "fine-print", "Only this auction, identity and deployment while this tab is connected. Your signer may prompt for each exact bidder and amount. Denial pauses approvals. Reload turns opt-in off."));
    }
    if (auction.status === "open") actions.append(el("small","fine-print",timer.ended ? "Awaiting the R20 deterministic close trigger and committed closed state." : "Consensus time controls anti-sniping extension and close eligibility."));
    card.append(actions); target.append(card);
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
  message(result.status==="seller_plan_pending"?`Seller authorization pending for ${short(result.fundingOperationId)}. Ask the seller tab to service its plans, then retry this exact bid.`:`Threshold bid ${result.status}${result.committedHeight?` at height ${result.committedHeight}`:""}.`,result.status==="unknown"?"warning":"success"); await refresh();
}
async function serviceSellerApprovals(manual) {
  if (!state.friday || !state.actor) return;
  if (!manual && (state.maintenancePromise || state.sellerAuctions.size === 0)) return;
  const controller = state.friday, captured = scope(), generation = state.generation;
  const pins = JSON.stringify(state.releasePins);
  const auctionIds = manual ? Object.values(state.view?.state?.auctions || {})
    .filter((auction) => auction.seller === state.actor && auction.status === "open").map((auction) => auction.id)
    : [...state.sellerAuctions];
  if (!auctionIds.length) return;
  const revision = state.approvalRevision, abort = new AbortController();
  state.approvalAbort = abort; updateControls();
  const assertActive = async () => {
    const check = () => {
      if (abort.signal.aborted || revision !== state.approvalRevision || generation !== state.generation
        || captured !== scope() || controller !== state.friday || pins !== JSON.stringify(state.releasePins)) throw new Error("Seller approval cancelled: identity, deployment or consent changed.");
      requireR20Ready();
      for (const id of auctionIds) {
        const auction = state.view?.state?.auctions?.[id];
        if (auction?.seller !== state.actor || auction.status !== "open"
          || (!manual && !state.sellerAuctions.has(id))) throw new Error("Seller auction scope changed. Review and opt in again.");
      }
    };
    check();
    const owner = await waitForApproval(abort.signal, () => controller.actor());
    check();
    if (owner !== state.actor) throw new Error("Signer account changed. Reconnect and opt in again.");
  };
  // An unavailable extension must not hold maintenance indefinitely. Late
  // signatures are discarded; stopping cannot close an extension-owned prompt.
  const timeout = setTimeout(() => abort.abort(), 60000);
  try {
    await runExclusiveMaintenance(captured, async (held) => {
      await assertActive();
      const plans = await waitForApproval(abort.signal, () => held.serviceSellerPlans({ auctionIds, deploymentPins: r20Pins(state.releasePins), signal: abort.signal, assertActive,
        onPlan: (plan) => {
          byId("seller-approval-status").textContent = `Approval requested: auction ${plan.auctionId}, bidder ${plan.bidderActor}, ${ui.formatSats(plan.bidAmount)} fake sats, operation ${plan.fundingOperationId}, expires ${ui.formatTime(plan.expiresAt)}. The signer must approve this exact plan.`;
        } }));
      await assertActive();
      byId("seller-approval-status").textContent = `Registered ${plans.registered} seller plan(s). ${manual ? "Manual pass complete." : "Approvals remain enabled for the selected auctions while this tab stays open."}`;
    }, abort.signal);
  } catch (error) {
    if (revision === state.approvalRevision) {
      stopSellerApprovals(`Approvals paused: ${error.message} No automatic retry. Review the exact bid and use the manual button or opt in again. Expired plans need a fresh bidder intent.`);
      renderAuctions();
    }
  } finally {
    clearTimeout(timeout);
    if (state.approvalAbort === abort) state.approvalAbort = null;
    updateControls();
  }
}
async function servicePayments() {
  requireR20Ready(); if (!state.friday) throw new Error("Connect a signer first.");
  // This explicit gesture cancels an automatic attempt and starts one manual
  // pass. It never grants future background signing authority.
  stopSellerApprovals("Manual seller approval pass requested. Automatic approvals are off.");
  await serviceSellerApprovals(true);
  await runMaintenance(scope());
  await refresh();
}

byId("login").onclick=()=>connect().catch((error)=>message(error.message,"error"));
byId("disconnect").onclick=()=>{disconnect();render();message("Disconnected. Seller approvals are off; reconnect to recover payments.");};
byId("stop-seller-approvals").onclick=()=>{stopSellerApprovals("Seller approvals stopped. An extension prompt may remain open; any late signature is discarded locally. Already-submitted plans remain recoverable.");render();};
byId("demo-login").onclick=()=>connectDemo().catch((error)=>message(error.message,"error"));
byId("refresh").onclick=()=>refresh().catch(()=>undefined);
byId("auction-search").oninput=(event)=>{state.query=event.target.value;renderAuctions();};
byId("faucet").onclick=(event)=>performAction("fund",event.currentTarget,"Funding…",async()=>{
  requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first.");
  const policy=state.friday.fundingPolicy(), parsed=ui.fundingAmount(byId("faucet-amount").value,policy.maxPerRequest); if(!parsed.ok) throw new Error(parsed.reason);
  const pending=await state.friday.pendingFakeFunding(); if(pending&&(pending.amount!==parsed.amount||pending.policyDigest!==policy.digest)) throw new Error(`Unresolved funding ${short(pending.operationId)} must retry its original amount and policy.`);
  const result=await state.friday.fundFake(parsed.amount); message(`${ui.formatSats(parsed.amount)} fake sats finalized in Coco (${short(result.operationId)}).`,"success"); byId("faucet-amount").value=""; await refresh();
}).catch(()=>undefined);
byId("process-payments").onclick=(event)=>performAction("maintenance",event.currentTarget,"Servicing…",servicePayments).catch(()=>undefined);
byId("create-form").onsubmit=(event)=>{event.preventDefault();return performAction("create",byId("create-submit"),"Signing…",async()=>{
  requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first.");
  const duration=exactInteger(byId("duration").value,"Duration",3),starting=exactInteger(byId("starting").value,"Starting bid"),increment=exactInteger(byId("increment").value,"Minimum increment"),reserve=byId("reserve").value.trim()===""?0:exactInteger(byId("reserve").value,"Reserve",0);
  if(duration>3600) throw new Error("Duration may not exceed 3,600 seconds."); const sellerPaymentPublicKey=await state.friday.sellerPaymentPublicKey();
  const id=`auction-${Date.now()}`; const signed=await sign(28640,[["t","plebeian-auctions-poc"],["auction",id]],{auction_id:id,title:byId("title").value,description:byId("description").value,image_url:byId("image").value,duration_seconds:duration,starting_bid:starting,min_increment:increment,reserve,funding_mode:"threshold_sigall_v1",seller_coco_payment_public_key:sellerPaymentPublicKey});
  const result=await api("/api/event",{method:"POST",body:JSON.stringify(signed)}); message(`Auction committed at height ${result.height}.`,"success"); byId("create-form").reset(); await refresh();
}).catch(()=>undefined);};

(async function boot(){
  try { await refresh(); }
  catch(error){message(error.message,"error");updateControls();}
})();
setInterval(()=>refresh().catch(()=>undefined),4000);
setInterval(()=>{if(state.view)renderAuctions();},1000);
