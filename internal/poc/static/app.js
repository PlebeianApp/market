const ui = window.PlebeianUI;
const state = {
  actor: "", signer: null, identityMode: "", config: null, releasePins: null, friday: null,
  view: null, wallet: null, validators: null, query: "", showHistory: false, generation: 0, publicStateAvailable: false,
  refreshPromise: null, maintenancePromise: null, maintenanceKind: "", actionKeys: new Set(), lastPresentation: "",
  validatorPromise: null,
  readinessPromise: null, readinessNextAt: 0, readinessFailures: 0,
  maintenanceNextAt: 0, maintenanceFailures: 0, maintenanceError: "",
  bidDrafts: new Map(), bidRecoveries: new Map(), expiredPrelockBids: [], auctionPayoutAvailability: new Map(),
  importedAuctionPayouts: new Set(), auctionPayoutImportStatuses: new Map(), maintenanceChecking: false,
  importedReturnOperations: new Set(), returnImportStatuses: new Map(), observedPendingReturns: new Set(),
  auctionRenderKey: "", auctionPresentationView: null, auctionControls: new Map(), auctionCountdowns: new Map(), auctionStatuses: new Map(),
  openAuctionDetails: new Set(), openValidatorDetails: new Set(),
  marketPhase: "loading", marketError: "", refreshErrorActive: false,
  validatorPhase: "loading", validatorError: "", walletPhase: "idle", walletError: "", readinessPhase: "checking",
  identityAttempt: 0, pairingAbort: null, profileAbort: null, profile: null, profilePhase: "idle",
};
const durationPresets = Object.freeze([
  ["duration-10m", 600], ["duration-30m", 1800], ["duration-1d", 86400], ["duration-7d", 604800],
]);
const releasePinsSchemaV1 = "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1";
const releasePinsSchemaV2 = "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V2";
const reviewedOneHourAuctionPolicyDigest = "257fb5bf2b414f206278ada15464030a075d6f4f51b9c2f6b965259136f9a777";
const reviewedAuctionPaymentPolicyDigest = "4d88017e3d191421aa46702ca9b6670fb324162c4c39d3ce4604bbfcfec3492b";
const byId = (id) => document.getElementById(id);
const short = (value) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
const exactInteger = (value, name, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be a safe whole number from ${minimum.toLocaleString("en-US")} through ${maximum.toLocaleString("en-US")}.`);
  }
  return number;
};

async function api(path, options = {}) {
  const response = await fetch(path, { redirect: "error", credentials: "same-origin", ...options,
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) } });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (type !== "application/json") throw new Error(`Unexpected response type from ${path}.`);
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return data;
}
async function committedState(suffix) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try { return await api(`/api/state${suffix}`, { signal: abort.signal }); }
  catch (error) {
    if (abort.signal.aborted) throw new Error("Committed state read timed out. New operations remain paused while exact payment recovery continues.");
    throw error;
  } finally { clearTimeout(timer); abort.abort(); }
}
function message(text, tone = "info") { const target = byId("message"); target.textContent = text; target.dataset.tone = tone; }
function runtimeStatus(phase, text) {
  state.readinessPhase = phase;
  const target = byId("runtime-status");
  if (!target) return;
  target.textContent = text; target.dataset.phase = phase;
}
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
  validatorsHash: config.validators_hash,
}; }
function readinessNow() { return typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now(); }
function r20RuntimeReady(config = state.config) {
  return config?.threshold_custody === true && config.browser_threshold_wallet_ready === true
    && config.browser_threshold_admission_ready === true && config.recovery_only === false;
}
function invalidateReadinessIdentity() {
  const credentialSigner = state.identityMode === "Clave · NIP-46" || state.identityMode === "DEV nsec · memory only";
  if (credentialSigner) { closeSigner(state.signer); state.signer = null; state.identityMode = ""; }
  state.generation += 1;
  // Retire the controller without discarding a tab-local private identity.
  clearNostrProfile();
  state.actor = ""; state.friday = null; state.wallet = null; state.expiredPrelockBids = []; state.publicStateAvailable = false;
  state.view = null; state.validators = null; state.marketPhase = "loading"; state.marketError = "";
  state.validatorPhase = "loading"; state.validatorError = ""; state.walletPhase = "idle"; state.walletError = "";
  state.maintenanceNextAt = 0; state.maintenanceFailures = 0; state.maintenanceError = ""; state.maintenanceChecking = false;
  state.importedAuctionPayouts.clear(); state.auctionPayoutImportStatuses.clear();
  state.importedReturnOperations.clear(); state.returnImportStatuses.clear(); state.observedPendingReturns.clear();
  state.bidRecoveries.clear();
  state.validatorPromise = null; byId("actor").textContent = "Disconnected"; render();
}
function readinessIdentityError() {
  const error = new Error("The independently pinned release identity changed or could not be verified. Reconnect after configuration is restored.");
  error.identityFault = true; return error;
}
function validateReadinessPins(pins) {
  if (!pins || (pins.schema !== releasePinsSchemaV1 && pins.schema !== releasePinsSchemaV2)) throw readinessIdentityError();
  const values = r20Pins(pins), id = /^[A-Za-z0-9_-]{1,160}$/, hash = /^[0-9a-f]{64}$/;
  for (const key of ["environmentId", "authNetworkId", "chainId", "committeeKeysetId", "committeeKeysetVersion", "dkgRunId"]) {
    if (typeof values[key] !== "string" || !id.test(values[key])) throw readinessIdentityError();
  }
  for (const key of ["genesisSha256", "publicKeyPackageSha256", "signerRosterDigest", "fakeFundingPolicyDigest"]) {
    if (typeof values[key] !== "string" || !hash.test(values[key])) throw readinessIdentityError();
  }
  if (typeof values.committeePublicKey !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(values.committeePublicKey)
    || typeof values.canonicalMintUrl !== "string" || !/^https:\/\/[^/?#@]+$/.test(values.canonicalMintUrl)) throw readinessIdentityError();
  if (pins.schema === releasePinsSchemaV2) {
    if (typeof values.validatorsHash !== "string" || !hash.test(values.validatorsHash)
      || typeof pins.auction_policy_digest !== "string" || !hash.test(pins.auction_policy_digest)
      || typeof pins.auction_payment_policy_digest !== "string" || !hash.test(pins.auction_payment_policy_digest)) throw readinessIdentityError();
  }
  return pins;
}
async function refreshReadiness() {
  if (state.readinessPromise) return state.readinessPromise;
  const now = readinessNow();
  if (now < state.readinessNextAt) return r20RuntimeReady() && Boolean(state.releasePins);
  if (!r20RuntimeReady()) runtimeStatus("checking", "Checking runtime…");
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
      const devSignerDisabled = state.identityMode === "DEV nsec · memory only" && config?.dev_nsec_signer_enabled !== true;
      const ready = r20RuntimeReady(config);
      if (identityChanged || devSignerDisabled) invalidateReadinessIdentity();
      else if (wasReady && !ready) state.maintenanceNextAt = 0;
      // A recovered runtime is not enough to authorize a new operation. Fence
      // the prior public view until this refresh reads committed state again.
      if (!wasReady && ready) state.publicStateAvailable = false;
      state.config = config; state.releasePins = pins;
      // Valid false can be backend warmup, not a transport failure. Keep two
      // observations inside its continuity window, even after slow collection.
      // Start-based spacing caps request rate without adding response latency.
      state.readinessFailures = 0;
      state.readinessNextAt = now + 4000;
      runtimeStatus(ready ? "ready" : "paused", ready ? "Runtime ready" : "Runtime warming up");
      updateControls();
      if (wasReady && !ready) message("New operations paused while runtime dependencies recover. Existing payment imports retain their normal safety checks.", "warning");
      return ready;
    } catch (error) {
      if (error.identityFault) {
        invalidateReadinessIdentity();
        runtimeStatus("error", "Release identity unavailable");
        message(error.message, "error");
      }
      else if (wasReady) state.maintenanceNextAt = 0;
      state.config = { ...state.config, browser_threshold_wallet_ready: false, browser_threshold_admission_ready: false };
      state.readinessFailures = Math.min(state.readinessFailures + 1, 4);
      state.readinessNextAt = readinessNow() + Math.min(30000, 1000 * 2 ** (state.readinessFailures - 1));
      if (!error.identityFault) runtimeStatus("retrying", "Readiness delayed · retrying");
      updateControls(); return false;
    } finally { clearTimeout(timer); abort.abort(); }
  })().finally(() => { state.readinessPromise = null; });
  return state.readinessPromise;
}

function requireR20Ready() {
  if (!r20RuntimeReady() || !state.releasePins) throw new Error("The reviewed R20 browser wallet and admission path is not active. Refresh or retry after runtime recovery.");
}
function requirePublicStateReady() {
  if (!state.publicStateAvailable) throw new Error("New operations are paused until committed auction and wallet state are available again.");
}

async function connectFridayController(signer) {
  await refreshReadiness(); requireR20Ready();
  if (!window.plebeianFridayR20Connect) throw new Error("The reviewed R20 browser connector did not load.");
  if (!state.releasePins) throw new Error("The independently release-pinned R20 manifest is unavailable.");
  return window.plebeianFridayR20Connect({ signer, pins: r20Pins(state.releasePins) });
}
async function installSigner(signer, mode) {
  await refreshReadiness(); requireR20Ready();
  resetIdentity(false, signer);
  const generation = state.generation;
  let installed = false;
  try {
    const actor = await signer.getPublicKey();
    if (!/^[0-9a-f]{64}$/.test(actor)) throw new Error("The signer returned an invalid Nostr account public key.");
    // NIP-07 getPublicKey is an explicit permission boundary in common browser
    // extensions. Consent once for this connected session instead of prompting
    // again on every four-second wallet refresh. Every signed event still goes
    // to the extension and the browser controller verifies its exact actor and
    // immutable fields, so an account change remains fail-closed on mutation.
    const sessionSigner = Object.freeze({
      getPublicKey: async () => actor,
      signEvent: async (event) => {
        const signed = await signer.signEvent(event);
        if (!signed || signed.pubkey !== actor || signed.kind !== event.kind || signed.created_at !== event.created_at
          || signed.content !== event.content || JSON.stringify(signed.tags) !== JSON.stringify(event.tags)) {
          throw new Error("The signer returned a different Nostr event or account.");
        }
        return signed;
      },
      close: async () => signer.close?.(),
    });
    const friday = await connectFridayController(sessionSigner);
    if (generation !== state.generation) return;
    state.actor = actor; state.signer = sessionSigner; state.identityMode = mode; state.friday = friday; state.wallet = null;
    installed = true;
    byId("actor").textContent = `${mode} · ${short(actor)}`;
    void loadNostrProfile(actor, generation);
    const capturedScope = scope();
    const pending = await runExclusiveMaintenance(capturedScope, (held) => held.pendingFakeFunding());
    if (friday !== state.friday || generation !== state.generation || capturedScope !== scope()) {
      throw new Error("Signer or deployment changed during funding recovery.");
    }
    if (pending) {
      byId("faucet-amount").value = String(pending.amount);
      message(`Recovered unresolved funding ${short(pending.operationId)}. Retry only its original ${ui.formatSats(pending.amount)} fake sats.`, "warning");
    }
    updateControls();
    await refresh();
  } finally {
    if (!installed) await Promise.resolve(signer.close?.()).catch(() => undefined);
  }
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
function closeSigner(signer) {
  try { Promise.resolve(signer?.close?.()).catch(() => undefined); } catch {}
}
function clearNostrProfile() {
  state.profileAbort?.abort(); state.profileAbort = null;
  state.profile = null; state.profilePhase = "idle";
}
function exactProfilePresentation(value, actor) {
  if (!value || typeof value !== "object" || value.actor !== actor || !/^[0-9a-f]{64}$/.test(value.eventId || "")
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) return null;
  for (const key of ["displayName", "name", "about", "picture", "nip05"]) {
    if (typeof value[key] !== "string" || value[key].length > (key === "about" ? 560 : key === "picture" ? 512 : 128)) return null;
  }
  if (value.picture) {
    const image = ui.imageURL(value.picture);
    if (!image.ok || image.url !== value.picture) return null;
  }
  return Object.freeze({ actor, eventId: value.eventId, createdAt: value.createdAt, displayName: value.displayName,
    name: value.name, about: value.about, picture: value.picture, nip05: value.nip05 });
}
function renderIdentity() {
  const connected = Boolean(state.actor && state.friday), profile = state.profile;
  if (document.body?.dataset) document.body.dataset.identity = connected ? "connected" : "disconnected";
  byId("plebeian-badge").dataset.state = "unavailable";
  byId("account-dashboard").hidden = !connected;
  byId("account-jump").hidden = !connected;
  byId("actor").hidden = connected;
  if (!connected) {
    byId("header-profile-name").textContent = "Account";
    byId("profile-name").textContent = "Connected bidder";
    byId("profile-key").textContent = "—";
    byId("account-signer").textContent = "—";
    return;
  }
  const name = profile?.displayName || profile?.name || "Connected bidder";
  byId("header-profile-name").textContent = name;
  byId("profile-name").textContent = name;
  byId("profile-key").textContent = short(state.actor);
  byId("account-signer").textContent = state.identityMode || "Connected signer";
  byId("profile-metadata-note").textContent = profile
    ? "Signed Nostr profile · display name and image are self-claimed"
    : state.profilePhase === "loading" ? "Looking for signed Nostr profile metadata…"
    : "Signed Nostr profile unavailable · using this account key";
  const fallback = byId("profile-avatar-fallback"), image = byId("profile-avatar");
  fallback.textContent = [...name][0]?.toLocaleUpperCase() || "P";
  if (!profile?.picture) {
    image.hidden = true; image.removeAttribute?.("src"); image.dataset.src = ""; image.dataset.failed = ""; fallback.hidden = false;
  } else if (image.dataset.src !== profile.picture && image.dataset.failed !== profile.picture) {
    const actor = state.actor, generation = state.generation, source = profile.picture;
    image.hidden = true; fallback.hidden = false; image.dataset.src = source; image.dataset.failed = "";
    image.onload = () => {
      if (state.actor !== actor || state.generation !== generation || state.profile?.picture !== source) return;
      image.hidden = false; fallback.hidden = true;
    };
    image.onerror = () => {
      if (image.dataset.src !== source) return;
      image.hidden = true; fallback.hidden = false; image.removeAttribute?.("src"); image.dataset.src = ""; image.dataset.failed = source;
    };
    image.src = source;
  }
}
async function loadNostrProfile(actor, generation) {
  clearNostrProfile();
  const abort = new AbortController(); state.profileAbort = abort; state.profilePhase = "loading"; renderIdentity();
  try {
    if (!window.plebeianReadNostrProfile) throw new Error("The signed Nostr profile reader is unavailable.");
    const value = await window.plebeianReadNostrProfile(actor, { signal: abort.signal });
    if (abort.signal.aborted || actor !== state.actor || generation !== state.generation || state.profileAbort !== abort) return;
    state.profile = value === null ? null : exactProfilePresentation(value, actor);
    state.profilePhase = state.profile ? "ready" : "unavailable";
  } catch (error) {
    if (abort.signal.aborted || actor !== state.actor || generation !== state.generation || state.profileAbort !== abort) return;
    state.profile = null; state.profilePhase = error?.name === "AbortError" ? "idle" : "unavailable";
  } finally {
    if (state.profileAbort === abort) state.profileAbort = null;
    if (actor === state.actor && generation === state.generation) renderIdentity();
  }
}
function resetIdentity(cancelPairing = true, preserveSigner = null) {
  if (cancelPairing) {
    state.identityAttempt += 1;
    state.pairingAbort?.abort(); state.pairingAbort = null;
  }
  const priorSigner = state.signer;
  clearNostrProfile();
  state.generation += 1;
  state.bidDrafts.clear(); state.bidRecoveries.clear(); state.auctionPayoutAvailability.clear(); state.importedAuctionPayouts.clear();
  state.auctionPayoutImportStatuses.clear(); state.importedReturnOperations.clear(); state.returnImportStatuses.clear(); state.observedPendingReturns.clear();
  state.actor = ""; state.signer = null; state.friday = null; state.wallet = null; state.identityMode = ""; state.expiredPrelockBids = []; state.publicStateAvailable = false;
  state.maintenanceNextAt = 0; state.maintenanceFailures = 0; state.maintenanceError = ""; state.maintenanceChecking = false;
  state.validatorPromise = null;
  byId("actor").textContent = "Disconnected"; updateControls();
  if (priorSigner !== preserveSigner) closeSigner(priorSigner);
}
function disconnect() {
  resetIdentity(true);
}

async function sign(kind, tags, content) {
  if (!state.actor || !state.signer) throw new Error("Connect a Nostr signer first.");
  const signer = state.signer, actor = state.actor, generation = state.generation;
  const signed = await signer.signEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify(content) });
  if (signer !== state.signer || actor !== state.actor || generation !== state.generation) {
    throw new Error("The signer changed before approval completed. Nothing was submitted.");
  }
  return signed;
}

function hideIdentityPanels() {
  byId("nip46-panel").hidden = true; byId("dev-nsec-panel").hidden = true;
  byId("nip46-open").setAttribute("aria-expanded", "false"); byId("dev-nsec-open").setAttribute("aria-expanded", "false");
}
function openIdentityPanel(name) {
  if (state.actor) return;
  hideIdentityPanels();
  const panel = byId(`${name}-panel`), button = byId(`${name}-open`);
  panel.hidden = false; button.setAttribute("aria-expanded", "true");
  byId(name === "nip46" ? "nip46-code" : "dev-nsec").focus();
}
function pairingStatus(text, phase = "waiting") {
  const target = byId("nip46-status"); target.textContent = text; target.dataset.phase = phase;
}
async function connectClave() {
  if (!window.plebeianCreateClaveNip46Signer) throw new Error("The reviewed Clave connector did not load.");
  const input = byId("nip46-code"), code = input.value; input.value = "";
  const attempt = ++state.identityAttempt, abort = new AbortController();
  state.pairingAbort?.abort(); state.pairingAbort = abort;
  pairingStatus("Waiting for Clave. Keep Auctions in the foreground and allow Clave notifications; do not switch apps during pairing.");
  let signer;
  try {
    signer = await window.plebeianCreateClaveNip46Signer(code, { signal: abort.signal, onStatus(phase) {
      if (attempt !== state.identityAttempt) return;
      pairingStatus(phase === "connected" ? "Clave connected. Confirming the account…"
        : "Waiting for Clave. Keep Auctions in the foreground so its relay response is not missed.", phase);
    } });
    if (attempt !== state.identityAttempt || abort.signal.aborted) {
      throw new Error("Clave pairing was cancelled.");
    }
    state.pairingAbort = null; hideIdentityPanels();
    await installSigner(signer, "Clave · NIP-46");
    message("Clave is connected for Nostr approvals. Wallet funds remain browser-local and do not sync from your phone.", "success");
  } catch (error) {
    if (state.pairingAbort === abort) state.pairingAbort = null;
    if (state.identityMode !== "Clave · NIP-46") await Promise.resolve(signer?.close?.()).catch(() => undefined);
    throw error;
  }
}
function cancelClavePairing() {
  state.identityAttempt += 1; state.pairingAbort?.abort(); state.pairingAbort = null;
  byId("nip46-code").value = ""; pairingStatus("Pairing cancelled. No payment action was started.", "cancelled");
}
async function connectDevNsec() {
  if (state.config?.dev_nsec_signer_enabled !== true) throw new Error("The development nsec signer is disabled in this build and runtime.");
  if (!window.plebeianCreateDevNsecSigner) throw new Error("The reviewed local development signer did not load.");
  const input = byId("dev-nsec"), nsec = input.value; input.value = "";
  const signer = window.plebeianCreateDevNsecSigner(nsec);
  hideIdentityPanels();
  await installSigner(signer, "DEV nsec · memory only");
  message("Disposable development key connected in this tab only. Browser memory cannot guarantee hardware-grade zeroization.", "warning");
}
const listingAttemptSchema = "PLEBEIAN_AUCTION_LISTING_ATTEMPT_V1";
function listingAttemptKey() { return `plebeian-auction-listing-attempt-v1:${scope()}`; }
function exactListingAttempt(value) {
  if (!value || value.schema !== listingAttemptSchema || value.scope !== scope() || value.actor !== state.actor
    || !/^[A-Za-z0-9_-]{1,160}$/.test(value.auctionId || "") || !value.signed || !value.listing
    || value.signed.kind !== 28640 || value.signed.content !== JSON.stringify(value.listing)
    || value.listing.auction_id !== value.auctionId || value.signed.pubkey !== state.actor
    || !/^[0-9a-f]{64}$/.test(value.signed.id || "") || !/^[0-9a-f]{128}$/.test(value.signed.sig || "")
    || !Number.isSafeInteger(value.signed.created_at) || value.signed.created_at < 0
    || JSON.stringify(value.signed.tags) !== JSON.stringify([["t", "plebeian-auctions-poc"], ["auction", value.auctionId]])
    || (value.minimumHeight !== null && (!Number.isSafeInteger(value.minimumHeight) || value.minimumHeight < 0))
    || typeof value.submitted !== "boolean") throw new Error("The saved listing recovery record is invalid.");
  return value;
}
function readListingAttempt() {
  const key = listingAttemptKey(); let raw;
  try { raw = localStorage.getItem(key); } catch { throw new Error("Persistent listing recovery storage is unavailable; auction creation remains disabled."); }
  if (raw === null) return null;
  try { return exactListingAttempt(JSON.parse(raw)); }
  catch (error) {
    throw new Error(`${error.message} Its submission outcome is uncertain, so auction creation is blocked until the retained record is inspected and recovered.`);
  }
}
function writeListingAttempt(value) {
  const exact = exactListingAttempt(value);
  try { localStorage.setItem(listingAttemptKey(), JSON.stringify(exact)); }
  catch { throw new Error("The exact signed listing could not be retained for response-loss recovery; it was not submitted."); }
}
function clearListingAttempt(auctionId) {
  const current = readListingAttempt();
  if (current?.auctionId !== auctionId) throw new Error("The listing recovery identity changed before completion.");
  try { localStorage.removeItem(listingAttemptKey()); }
  catch { throw new Error("The completed listing recovery record could not be cleared. Retry before creating another auction."); }
}
function operationalPolicyPinsResult() {
  const timing = ui.auctionPolicy(state.config?.auction_policy);
  if (!timing.ok) return timing;
  const payment = ui.auctionPaymentPolicy(state.config?.auction_payment_policy);
  if (!payment.ok) return payment;
  const pins = state.releasePins;
  if (pins?.schema !== releasePinsSchemaV2
    || pins.auction_policy_digest !== reviewedOneHourAuctionPolicyDigest
    || pins.auction_payment_policy_digest !== reviewedAuctionPaymentPolicyDigest
    || state.config?.auction_policy_digest !== reviewedOneHourAuctionPolicyDigest
    || state.config?.auction_payment_policy_digest !== reviewedAuctionPaymentPolicyDigest
    || timing.policy.maxDurationSeconds !== 3600) {
    return { ok: false, reason: "The reviewed one-hour auction and payment policies are not bound to this release." };
  }
  return { ok: true, timing: timing.policy, payment: payment.policy };
}
function durationPolicyResult() {
  const parsed = operationalPolicyPinsResult();
  return parsed.ok ? { ok: true, policy: parsed.timing } : parsed;
}
function paymentPolicyResult() {
  const parsed = operationalPolicyPinsResult();
  return parsed.ok ? { ok: true, policy: parsed.payment } : parsed;
}
function setDurationError(text = "") {
  const input = byId("duration"), error = byId("duration-error");
  input.setCustomValidity(text); input.setAttribute("aria-invalid", text ? "true" : "false"); error.textContent = text;
}
function updateDurationControl(parsed = durationPolicyResult()) {
  const input = byId("duration"), unit = byId("duration-unit"), range = byId("duration-range"), help = byId("duration-help");
  if (!unit.value) unit.value = "minutes";
  if (!parsed.ok) {
    range.textContent = "Policy unavailable"; help.textContent = `${parsed.reason} Auction creation remains disabled.`;
    for (const [id] of durationPresets) byId(id).disabled = true;
    return;
  }
  let bounds = ui.durationBounds(unit.value, state.config.auction_policy);
  if (!bounds.ok) { unit.value = "seconds"; bounds = ui.durationBounds(unit.value, state.config.auction_policy); }
  if (!bounds.ok) { range.textContent = "Policy unavailable"; help.textContent = bounds.reason; return; }
  input.min = String(bounds.minimum); input.max = String(bounds.maximum);
  const policy = parsed.policy;
  for (const [id, seconds] of durationPresets) byId(id).disabled = seconds < policy.minDurationSeconds || seconds > policy.maxDurationSeconds;
  range.textContent = `${ui.formatDuration(policy.minDurationSeconds)}–${ui.formatDuration(policy.maxDurationSeconds)}`;
	help.textContent = `Choose any allowed duration. Bids committed in the final ${ui.formatDuration(policy.lateBidWindowSeconds)} keep at least ${ui.formatDuration(policy.lateBidExtensionSeconds)} remaining, capped at ${ui.formatDuration(policy.maxTotalExtensionSeconds)} total extension. Payout authorization covers that extension cap plus a ${ui.formatDuration(policy.emergencyRecoverySeconds)} recovery window.`;
}
function applyDurationPreset(seconds) {
  const parsed = durationPolicyResult();
  if (!parsed.ok || seconds < parsed.policy.minDurationSeconds || seconds > parsed.policy.maxDurationSeconds) return;
  const unit = byId("duration-unit"), input = byId("duration");
  if (seconds % 86400 === 0) { unit.value = "days"; input.value = String(seconds / 86400); }
  else if (seconds % 60 === 0) { unit.value = "minutes"; input.value = String(seconds / 60); }
  else { unit.value = "seconds"; input.value = String(seconds); }
  setDurationError(); updateDurationControl(); input.focus();
}
function updateControls() {
  const connectReady = Boolean(state.releasePins && r20RuntimeReady());
  const ready = Boolean(state.actor && state.friday && connectReady && state.publicStateAvailable);
  const identityConnecting = state.actionKeys.has("identity:connect");
  const identityConnected = Boolean(state.actor && state.friday);
  const devNsecEnabled = state.config?.dev_nsec_signer_enabled === true;
  const timing = durationPolicyResult(), payment = paymentPolicyResult();
  renderIdentity();
  byId("login").disabled = !connectReady || identityConnecting;
  byId("demo-login").disabled = !connectReady || identityConnecting;
  byId("nip46-open").disabled = !connectReady || identityConnecting;
  byId("nip46-connect").disabled = !connectReady || identityConnecting;
  byId("dev-nsec-open").disabled = !connectReady || identityConnecting;
  byId("dev-nsec-connect").disabled = !connectReady || identityConnecting;
  byId("login").hidden = identityConnected;
  byId("demo-login").hidden = identityConnected;
  byId("nip46-open").hidden = identityConnected;
  byId("dev-nsec-open").hidden = identityConnected || !devNsecEnabled;
  byId("disconnect").hidden = !identityConnected;
  byId("faucet").disabled = !ready;
  byId("disconnect").disabled = !identityConnected;
  if (identityConnected) hideIdentityPanels();
  byId("create-submit").disabled = !ready || !timing.ok || !payment.ok;
  updateDurationControl(timing);
  if (payment.ok) {
    for (const id of ["starting", "increment", "reserve"]) byId(id).max = String(payment.policy.maxBidAmount);
    for (const id of ["starting-help", "increment-help", "reserve-help"]) {
      byId(id).textContent = `Up to ${ui.formatSats(payment.policy.maxBidAmount)} fake sats`;
    }
  }
  const policy = state.config?.fake_funding_policy;
  if (policy) {
    byId("faucet-amount").max = String(policy.max_per_request);
    byId("faucet-help").textContent = `Per request: 1–${ui.formatSats(policy.max_per_request)}. Browser-wallet advisory resulting balance: ${ui.formatSats(policy.max_resulting_balance)}. Mint-wide and ingress controls are separate.`;
  }
  syncAuctionControls();
}

function outbidReturnOperationIds({ includeImported = false } = {}) {
  if (!state.actor || !state.view) return [];
  const ownBids = [], latest = new Map();
  for (const [bidKey, bid] of Object.entries(state.view.state?.bids || {})) {
    if (bid.bidder !== state.actor || typeof bid.integrated_funding_id !== "string") continue;
    const entry = { ...bid, exact_bid_id: typeof bid.id === "string" ? bid.id : bidKey };
    ownBids.push(entry);
    const prior = latest.get(bid.auction_id);
    if (!prior || Number(bid.committed_at) > Number(prior.committed_at)) latest.set(bid.auction_id, entry);
  }
  return ownBids.filter((bid) => {
    const auction = state.view.state?.auctions?.[bid.auction_id];
    if (!auction) return false;
    const exactLeader = auction.leader_bid_id === bid.exact_bid_id;
    const winnerBidId = auction.status !== "open" && auction.winner === state.actor
      ? (state.view.state?.bids?.[auction.leader_bid_id]?.bidder === state.actor
        ? auction.leader_bid_id : latest.get(bid.auction_id)?.exact_bid_id)
      : "";
    return !exactLeader && winnerBidId !== bid.exact_bid_id
      && (includeImported || !state.importedReturnOperations.has(bid.integrated_funding_id));
  }).map((bid) => bid.integrated_funding_id);
}
function pendingOutbidReturnOperationIds() { return outbidReturnOperationIds(); }
function committedBidForOperationExact(auctionId, fundingOperationId, bidAmount) {
  if (!state.actor || typeof auctionId !== "string" || typeof fundingOperationId !== "string"
    || !Number.isSafeInteger(bidAmount) || bidAmount < 1) return null;
  const matches = Object.entries(state.view?.state?.bids || {}).filter(([, bid]) =>
    bid?.auction_id === auctionId && bid?.bidder === state.actor
      && bid?.integrated_funding_id === fundingOperationId);
  if (matches.length !== 1) return null;
  const [bidId, bid] = matches[0];
  if (Number(bid?.amount) !== bidAmount) return null;
  return { ...bid, exact_bid_id: typeof bid.id === "string" ? bid.id : bidId };
}
function nextMaintenanceDelay() { return pendingOutbidReturnOperationIds().length ? 4000 : 15000; }
function observePendingOutbidReturns() {
  const pending = new Set(pendingOutbidReturnOperationIds());
  if ([...pending].some((operationId) => !state.observedPendingReturns.has(operationId))) state.maintenanceNextAt = 0;
  state.observedPendingReturns = pending;
}

async function repairBidReturnAcknowledgements(controller, operationIds) {
  if (typeof controller.repairBidReturnAcknowledgement !== "function") return;
  const failures = [];
  for (const operationId of operationIds) {
    try { await controller.repairBidReturnAcknowledgement(operationId); }
    catch (error) {
      failures.push(new Error(`bid return acknowledgement ${operationId}: ${error?.message || String(error)}`));
    }
  }
  if (failures.length > 0) {
    const details = failures.map((error) => error.message).join(" ");
    throw new AggregateError(failures, `${failures.length} exact acknowledgement repair(s) remain pending: ${details}`);
  }
}

async function runMaintenance(capturedScope, { force = false, reportFailure = false, repairAcknowledgements = null } = {}) {
  const emptyResult = { refunds: 0, winnerPayments: 0, winnerAuctionIds: [], refundOperationIds: [] };
  if (!state.friday || !capturedScope) return emptyResult;
  const controller = state.friday, maintenanceGeneration = state.generation;
  const stillCurrent = () => maintenanceGeneration === state.generation
    && controller === state.friday && capturedScope === scope();
  while (state.maintenancePromise) {
    const priorKind = state.maintenanceKind;
    let prior;
    try { prior = await state.maintenancePromise; }
    catch (error) {
      // A preceding bid/listing callback owns its own rejection. Forced exact
      // recovery must still take the next slot during a public-state outage.
      if (!force || priorKind !== "exclusive") throw error;
      if (!stillCurrent()) return emptyResult;
      continue;
    }
    if (!force) return prior;
    if (!stillCurrent()) return emptyResult;
  }
  const now = readinessNow();
  if (!force && now < state.maintenanceNextAt) return emptyResult;
  state.maintenanceChecking = true; syncAuctionStatuses();
  state.maintenanceKind = "maintenance";
  state.maintenancePromise = (async () => {
    try {
      const failures = [];
      if (typeof repairAcknowledgements === "function") {
        try { await repairAcknowledgements(controller); }
        catch (error) { failures.push(error); }
      }
      let imported = emptyResult;
      try { imported = await controller.importAvailable(); }
      catch (error) { failures.push(error); }
      if (failures.length > 0) {
        const details = failures.map((error) => error?.message || String(error)).join(" ");
        throw new AggregateError(failures, `${failures.length} exact payment maintenance operation(s) remain pending: ${details}`);
      }
      if (!stillCurrent()) return emptyResult;
      for (const auctionId of Array.isArray(imported.winnerAuctionIds) ? imported.winnerAuctionIds : []) {
        state.importedAuctionPayouts.add(auctionId); state.auctionPayoutImportStatuses.set(auctionId, "imported");
      }
      for (const operationId of Array.isArray(imported.refundOperationIds) ? imported.refundOperationIds : []) {
        state.importedReturnOperations.add(operationId); state.returnImportStatuses.set(operationId, "imported");
      }
      state.maintenanceFailures = 0; state.maintenanceError = "";
      observePendingOutbidReturns();
      state.maintenanceNextAt = readinessNow() + nextMaintenanceDelay();
      if (imported.refunds || imported.winnerPayments) {
        message(`Imported ${imported.refunds} certified outbid return(s) and ${imported.winnerPayments} seller payout(s).`, "success");
      }
      return imported;
    } catch (error) {
      if (!stillCurrent()) return emptyResult;
      state.maintenanceFailures = Math.min(state.maintenanceFailures + 1, 4);
      state.maintenanceError = error?.message || "Automatic return check failed.";
      const pendingDelay = Math.min(15000, 4000 * 2 ** (state.maintenanceFailures - 1));
      const idleDelay = Math.min(120000, 15000 * 2 ** (state.maintenanceFailures - 1));
      state.maintenanceNextAt = readinessNow() + (pendingOutbidReturnOperationIds().length ? pendingDelay : idleDelay);
      if (force || reportFailure) throw error;
      return emptyResult;
    }
  })().finally(() => {
    state.maintenancePromise = null; state.maintenanceKind = "";
    if (stillCurrent()) { state.maintenanceChecking = false; syncAuctionStatuses(); }
  });
  return state.maintenancePromise;
}
async function runExclusiveMaintenance(capturedScope, operation) {
  const expectedController = state.friday, expectedGeneration = state.generation;
  while (state.maintenancePromise) {
    await state.maintenancePromise.catch(() => undefined);
  }
  if (capturedScope !== scope() || expectedController !== state.friday || expectedGeneration !== state.generation) {
    throw new Error("Signer or deployment changed before wallet maintenance.");
  }
  const controller = expectedController;
  if (!controller) throw new Error("Connect a signer first.");
  state.maintenanceKind = "exclusive";
  state.maintenancePromise = (async () => operation(controller))()
    .finally(() => { state.maintenancePromise = null; state.maintenanceKind = ""; });
  return state.maintenancePromise;
}
async function recoverRetainedPaymentsAfterPublicReadFailure(capturedScope, generation, controller) {
  const stillCurrent = () => generation === state.generation && controller === state.friday && capturedScope === scope();
  if (!state.actor || !controller || !capturedScope || !stillCurrent()) return false;
  const failures = [];
  try { await runMaintenance(capturedScope, { force: true }); }
  catch (error) { failures.push(error); }
  if (!stillCurrent()) return;
  try {
    const balance = await runExclusiveMaintenance(capturedScope, (held) => held.balance());
    if (stillCurrent()) { state.wallet = balance; state.walletPhase = "ready"; renderWallet(); syncAuctionStatuses(); }
  } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Retained payment recovery also failed while committed state was unavailable.");
  return stillCurrent();
}
function refreshValidators(generation, capturedScope, controller) {
  if (state.validatorPromise) return;
  const stillCurrent = () => generation === state.generation && capturedScope === scope() && controller === state.friday;
  const task = api("/api/validators").then((validators) => {
    if (!stillCurrent()) return;
    state.validators = validators; state.validatorPhase = "ready"; state.validatorError = ""; renderValidators();
  }).catch((error) => {
    if (!stillCurrent()) return;
    state.validators = null; state.validatorPhase = "error";
    state.validatorError = error?.message || "Validator observations could not be read."; renderValidators();
  }).finally(() => { if (state.validatorPromise === task) state.validatorPromise = null; });
  state.validatorPromise = task;
}
async function refresh() {
  if (state.refreshPromise) return state.refreshPromise;
  const generation = state.generation, capturedScope = scope(), capturedController = state.friday;
  state.refreshPromise = (async () => {
    if (!state.view) { state.marketPhase = "loading"; state.marketError = ""; renderAuctions(); }
    await refreshReadiness();
    if (generation !== state.generation || capturedScope !== scope() || capturedController !== state.friday) return;
    const suffix = state.actor ? `?actor=${encodeURIComponent(state.actor)}` : "";
    refreshValidators(generation, capturedScope, capturedController);
    let view;
    try { view = await committedState(suffix); }
    catch (viewError) {
      if (generation !== state.generation || capturedScope !== scope() || capturedController !== state.friday) return;
      state.publicStateAvailable = false; updateControls();
      try {
        if (await recoverRetainedPaymentsAfterPublicReadFailure(capturedScope, generation, capturedController)) {
          viewError.retainedRecoveryAvailable = true;
        }
      }
      catch (recoveryError) {
        throw new AggregateError([viewError, recoveryError], `${viewError.message} Retained payment recovery also failed.`);
      }
      throw viewError;
    }
    if (generation !== state.generation || capturedScope !== scope() || capturedController !== state.friday) return;
    state.publicStateAvailable = true; state.view = view; observePendingOutbidReturns();
    state.marketPhase = "ready"; state.marketError = "";
    if (state.refreshErrorActive) { message(""); state.refreshErrorActive = false; }
    if (state.actor && state.friday) {
      const controller = state.friday;
      state.walletPhase = "loading"; state.walletError = "";
      try {
        const currentActor = await controller.actor();
        if (generation !== state.generation || controller !== state.friday || capturedScope !== scope()) return;
        if (currentActor !== state.actor) { disconnect(); message("Signer account changed. Reconnect before continuing.", "warning"); render(); return; }
        const ownedOpenAuctions = Object.values(state.view?.state?.auctions || {})
          .filter((auction) => auction.status === "open" && auction.seller === state.actor);
        const retained = new Set(ownedOpenAuctions.map((auction) => auction.id));
        for (const id of state.auctionPayoutAvailability.keys()) {
          if (!retained.has(id)) state.auctionPayoutAvailability.delete(id);
        }
        const ownedClosedAuctions = Object.values(state.view?.state?.auctions || {})
          .filter((auction) => auction.status !== "open" && auction.winner && auction.seller === state.actor);
        const ownedPayoutAuctionIds = [...new Set([...ownedOpenAuctions, ...ownedClosedAuctions].map((auction) => auction.id))];
        const returnOperationIds = outbidReturnOperationIds({ includeImported: true });
        const recoveryFailures = [];
        const preserveRecoveryFailure = (kind, identity, error) => {
          recoveryFailures.push(new Error(`${kind} ${identity}: ${error?.message || String(error)}`));
        };
        if (typeof controller.repairAuctionPayoutDiscovery === "function") {
          for (const auctionId of ownedPayoutAuctionIds) {
            try {
              await runExclusiveMaintenance(capturedScope, (held) => held.repairAuctionPayoutDiscovery(auctionId));
            } catch (error) { preserveRecoveryFailure("seller payout discovery", auctionId, error); }
          }
        }
        const repairAcknowledgements = (held) => repairBidReturnAcknowledgements(held, returnOperationIds);
        try { await runMaintenance(capturedScope, {
          reportFailure: recoveryFailures.length > 0, repairAcknowledgements,
        }); }
        catch (error) { recoveryFailures.push(error); }
        if (recoveryFailures.length > 0) {
          const details = recoveryFailures.map((error) => error?.message || String(error)).join(" ");
          throw new AggregateError(recoveryFailures,
            `${recoveryFailures.length} exact recovery repair(s) remain pending: ${details}`);
        }
        const snapshot = await runExclusiveMaintenance(capturedScope, async (held) => {
          const balance = await held.balance();
          const payoutAvailability = await Promise.all(ownedOpenAuctions
            .filter((auction) => state.auctionPayoutAvailability.get(auction.id) !== "ready")
            .map(async (auction) => {
              try { return [auction.id, await held.readAuctionPayout(auction.id) === null ? "missing" : "ready"]; }
              catch { return [auction.id, "unknown"]; }
            }));
          const payoutStatuses = typeof held.readAuctionPayoutImportStatus === "function"
            ? await Promise.all(ownedClosedAuctions.map(async (auction) => {
              try { return [auction.id, await held.readAuctionPayoutImportStatus(auction.id)]; }
              catch { return [auction.id, "unknown"]; }
            })) : [];
          const returnStatuses = typeof held.readBidReturnImportStatus === "function"
            ? await Promise.all(returnOperationIds.map(async (operationId) => {
              try { return [operationId, await held.readBidReturnImportStatus(operationId)]; }
              catch { return [operationId, "unknown"]; }
            })) : returnOperationIds.map((operationId) => [operationId, "unknown"]);
          const bidRecoveries = typeof held.retainedBidRecoveries === "function"
            ? await held.retainedBidRecoveries() : [];
          const expiredPrelockBids = typeof held.expiredPrelockPending === "function"
            ? await held.expiredPrelockPending() : [];
          return { balance, payoutAvailability, payoutStatuses, returnStatuses, bidRecoveries, expiredPrelockBids };
        });
        if (generation !== state.generation || controller !== state.friday || capturedScope !== scope()) return;
        state.wallet = snapshot.balance;
        for (const [auctionId, availability] of snapshot.payoutAvailability) {
          state.auctionPayoutAvailability.set(auctionId, availability);
        }
        for (const [auctionId, status] of snapshot.payoutStatuses) {
          if (status === "settled") state.importedAuctionPayouts.add(auctionId);
          else state.importedAuctionPayouts.delete(auctionId);
          state.auctionPayoutImportStatuses.set(auctionId,
            ["awaiting_terminal", "pending", "wallet_imported_ack_pending", "settled"].includes(status) ? status : "unknown");
        }
        const retainedReturns = new Set(returnOperationIds);
        for (const operationId of state.returnImportStatuses.keys()) {
          if (!retainedReturns.has(operationId)) state.returnImportStatuses.delete(operationId);
        }
        for (const [operationId, status] of snapshot.returnStatuses) {
          if (status === "settled") state.importedReturnOperations.add(operationId);
          else state.importedReturnOperations.delete(operationId);
          state.returnImportStatuses.set(operationId,
            ["pending", "wallet_imported_ack_pending", "settled"].includes(status) ? status : "unknown");
        }
        state.bidRecoveries = new Map(snapshot.bidRecoveries.map((entry) => [entry.auctionId, entry]));
        const retainedOperationIds = new Set(snapshot.bidRecoveries.map((entry) => entry.fundingOperationId));
        state.expiredPrelockBids = snapshot.expiredPrelockBids
          .filter((entry) => !retainedOperationIds.has(entry.fundingOperationId));
        observePendingOutbidReturns();
        state.walletPhase = "ready";
      } catch (error) {
        if (generation !== state.generation || controller !== state.friday || capturedScope !== scope()) return;
        state.publicStateAvailable = false; state.wallet = null; state.walletPhase = "error"; state.walletError = error.message; updateControls();
      }
    } else { state.wallet = null; state.walletPhase = "idle"; state.walletError = ""; }
    render();
  })().catch((error) => {
    if (generation === state.generation && capturedScope === scope() && capturedController === state.friday) {
      state.publicStateAvailable = false; updateControls();
      state.marketPhase = state.view ? "stale" : "error"; state.marketError = error.message;
      state.refreshErrorActive = true; renderAuctions();
      const recoveryNote = error?.retainedRecoveryAvailable
        ? " New operations are paused; exact retained payment recovery remains available."
        : "";
      message(`${error.message}${recoveryNote}`, recoveryNote ? "warning" : "error"); throw error;
    }
    return undefined;
  }).finally(() => { state.refreshPromise = null; });
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

function listingMatches(attempt, committed) {
  const listing = attempt.listing;
  return committed && committed.id === attempt.auctionId && committed.status === "open" && committed.seller === state.actor
    && committed.title === listing.title && committed.description === listing.description
    && (committed.image_url || "") === listing.image_url
    && committed.original_end_time - committed.created_at === listing.duration_seconds
    && committed.starting_bid === listing.starting_bid && committed.min_increment === listing.min_increment
    && committed.reserve === listing.reserve
    && committed.seller_coco_payment_public_key === listing.seller_coco_payment_public_key;
}
async function finishListingAttempt(attempt) {
  let committed = null, height = attempt.minimumHeight;
  if (attempt.submitted) {
    message("Recovering the exact signed listing before allowing another auction…", "warning");
    await refresh();
    committed = state.view?.state?.auctions?.[attempt.auctionId] || null;
  }
  if (!committed) {
    const submitted = { ...attempt, submitted: true };
    writeListingAttempt(submitted);
    message("Listing signed and retained. Submitting its exact event for committed auction state…", "info");
    let result;
    try { result = await api("/api/event", { method: "POST", body: JSON.stringify(submitted.signed) }); }
    catch (error) {
      if (error.status === 422 && /signed event is outside the consensus-time window/i.test(error.message)) {
        clearListingAttempt(submitted.auctionId);
        throw new Error("The retained listing was definitively rejected as expired and was not committed. Submit again to sign a fresh event.");
      }
      throw error;
    }
    height = exactInteger(result.height, "Committed height", 0);
    attempt = { ...submitted, minimumHeight: height };
    writeListingAttempt(attempt);
    message(`Listing submitted at height ${height}. Verifying the exact committed fields before payout setup…`, "info");
    committed = await refreshCommittedAuction(attempt.auctionId, height);
  }
  if (height !== null && Number(state.view?.state?.height) < height) committed = null;
  if (!listingMatches(attempt, committed)) {
    throw new Error("Committed auction differs from the retained signed listing; offline payout authorization was not created.");
  }
  message("Committed listing verified. Registering its bounded offline payout authorization…", "info");
  await authorizeCommittedAuctionPayout(committed);
  clearListingAttempt(attempt.auctionId);
  message(`Auction committed${height === null ? "" : ` at height ${height}`}. One auction-scoped payout authorization now covers bids while the seller is offline.`, "success");
  byId("create-form").reset(); setDurationError(); updateDurationControl(); await refresh();
}

function auctionAcceptsNewBids(auction) {
  const consensusTime = Number(state.view?.state?.last_consensus_time), endTime = Number(auction?.end_time);
  return auction?.status === "open" && Number.isSafeInteger(consensusTime)
    && Number.isSafeInteger(endTime) && consensusTime < endTime;
}
function recoveryIsCurrent(recovery) {
  return auctionAcceptsNewBids(state.view?.state?.auctions?.[recovery.auctionId]);
}
function configurePaymentAction(action) {
  const button = byId("process-payments");
  if (!action) {
    button.hidden = true; button.disabled = true; button.onclick = null; button.textContent = ""; return;
  }
  button.hidden = false;
  if (!state.actionKeys.has(action.key)) button.textContent = action.label;
  button.disabled = !state.friday || state.actionKeys.has(action.key);
  button.onclick = (event) => performAction(action.key, event.currentTarget, action.pendingLabel, action.run)
    .finally(() => renderWallet()).catch(() => undefined);
}
function renderWallet() {
  const wallet = state.wallet, target = byId("notes"), overview = byId("payment-overview"); target.replaceChildren();
  const present = (title, detail, tone = "") => {
    overview.dataset.tone = tone; overview.replaceChildren(el("strong", "", title), el("span", "", detail));
  };
  byId("spendable").textContent = wallet ? ui.formatSats(wallet.available) : "—";
  byId("locked").textContent = wallet ? ui.formatSats(wallet.reserved) : "—";
  byId("refundable").textContent = "—";
  configurePaymentAction(null);
  const recoveryLabels = {
    payment_prepared: "Payment preparation was retained; the lock outcome must be recovered exactly.",
    funds_locked: "The operation reached its retained funds-locked phase; current proof balance is not projected here and no second payment should be created.",
    authority_pending: "The exact authority outcome is pending or its response was lost.",
  };
  const recoveries = [...state.bidRecoveries.values()].sort((left, right) => {
    const current = Number(recoveryIsCurrent(right)) - Number(recoveryIsCurrent(left));
    return current || left.auctionId.localeCompare(right.auctionId);
  });
  const recoveryOperationIds = new Set(recoveries.map((entry) => entry.fundingOperationId));
  const visibleExpiredPrelocks = state.expiredPrelockBids
    .filter((entry) => !recoveryOperationIds.has(entry.fundingOperationId));
  const appendOperationDetails = (stale = false) => {
    for (const recovery of recoveries) {
      const current = recoveryIsCurrent(recovery), note = el("div", `note ${current ? "" : "historical-recovery"}`.trim());
      note.append(el("strong", "", `${stale ? "Last known · " : ""}${current ? "Current auction" : "Earlier auction"} recovery · ${ui.formatSats(recovery.retainedBidAmount)} fake sats`),
        el("small", "", `${stale ? "Observed before wallet status became unavailable · " : ""}Auction ${recovery.auctionId} · ${recoveryLabels[recovery.recoveryStage] || "Exact payment recovery is retained."}`),
        el("small", "receipt", `Operation ${recovery.fundingOperationId}`));
      target.append(note);
    }
    for (const pending of visibleExpiredPrelocks) {
      const note = el("div", "note historical-recovery");
      note.append(el("strong", "", `${stale ? "Last known · " : ""}Old pre-lock intent · ${ui.formatSats(pending.bidAmount)} fake sats`),
        el("small", "", `${stale ? "Observed before wallet status became unavailable · " : ""}Auction ${pending.auctionId} · expired ${ui.formatTime(pending.expiresAt)}`),
        el("small", "receipt", `Operation ${pending.fundingOperationId}`));
      target.append(note);
    }
  };
  if (state.walletPhase === "error") {
    present("Payment status unavailable", "No completion is claimed. Exact retained operations remain preserved; retry only this status check.", "uncertain");
    target.append(empty("Wallet state unavailable", state.walletError || "The browser wallet could not be read. Auction browsing remains available."));
    appendOperationDetails(true);
    if (state.friday) configurePaymentAction({ key: "maintenance", label: "Retry payment status", pendingLabel: "Checking payments…", run: servicePayments });
    return;
  }
  if (!wallet) {
    present("Connect to see payments", "Returns and seller payouts are scoped to the exact connected identity.");
    target.append(empty("No payment details yet", "The threshold wallet remains fail-closed until an exact signer and release are connected."));
    return;
  }
  const card = el("div", "note");
  card.append(el("strong", "", `${ui.formatSats(wallet.available)} spendable fake sats`),
    el("small", "", `${ui.formatSats(wallet.reserved)} currently reserved by the Coco wallet`),
    el("small", "", "Additional locked, pending, and unresolved proof totals are not projected by this R70 wallet API; exact operation states are listed separately."),
    el("small", "receipt", `Actor ${short(state.actor)} · ${state.identityMode}`));
  target.append(card);
  appendOperationDetails();
  if (state.maintenanceError) {
    const note = el("div", "note"); note.append(el("strong", "", "Last automatic check failed"),
      el("small", "", state.maintenanceError)); target.append(note);
  }

  const currentRecovery = recoveries.find((entry) => recoveryIsCurrent(entry));
  const historicalRecovery = recoveries.find((entry) => !recoveryIsCurrent(entry));
  if (currentRecovery) {
    const remaining = recoveries.length - 1;
    present("Bid recovery needs you",
      `The ${ui.formatSats(currentRecovery.retainedBidAmount)} fake-sat bid operation for auction ${currentRecovery.auctionId} remains in exact recovery.${remaining ? ` ${remaining} more retained operation${remaining === 1 ? " is" : "s are"} listed in Payment details.` : ""}`,
      "attention");
    configurePaymentAction({ key: `bid:${currentRecovery.auctionId}`,
      label: "Resume exact bid", pendingLabel: "Resuming exact bid…", run: async () => {
        message(`Resuming only retained operation ${short(currentRecovery.fundingOperationId)}. No second payment will be created.`, "info");
        await placeBid(currentRecovery.auctionId, currentRecovery.retainedBidAmount, (phase) => {
          const copy = bidProgressCopy[phase];
          if (copy) { byId("process-payments").textContent = copy[0]; message(copy[1], "info"); }
        });
      } });
    return;
  }
  const statuses = [...state.auctionPayoutImportStatuses.values(), ...state.returnImportStatuses.values()];
  const unknown = statuses.filter((status) => status === "unknown").length;
  const acknowledgementPending = statuses.filter((status) => status === "wallet_imported_ack_pending").length;
  const available = statuses.filter((status) => status === "pending").length;
  const preparing = statuses.filter((status) => status === "awaiting_terminal").length;
  const settled = statuses.filter((status) => status === "settled").length;
  if (state.maintenanceChecking) {
    present("Checking payments automatically", "Certified returns and seller payouts are being checked. No action is needed.", "attention");
  } else if (state.maintenanceError || unknown) {
    present("Automatic recovery delayed", `${unknown || 1} payment status ${unknown === 1 ? "is" : "items are"} uncertain. No import or settlement is claimed.`, "uncertain");
    configurePaymentAction({ key: "maintenance", label: "Retry payment recovery", pendingLabel: "Checking payments…", run: servicePayments });
  } else if (visibleExpiredPrelocks[0]) {
    const firstExpired = visibleExpiredPrelocks[0];
    present("Old bid intent needs review", `${ui.formatSats(firstExpired.bidAmount)} fake sats were never confirmed as locked. The exact safety check runs before anything is discarded.`, "attention");
    configurePaymentAction({ key: `discard-prelock:${firstExpired.fundingOperationId}`,
      label: "Review old bid intent", pendingLabel: "Verifying intent…", run: async () => {
        if (!window.confirm(`Discard expired pre-lock intent ${firstExpired.fundingOperationId} for auction ${firstExpired.auctionId}? This is allowed only if no seller plan, payment lock or cancellation journal exists.`)) return;
        requireR20Ready(); const controller = state.friday, captured = scope();
        if (!controller) throw new Error("Connect a signer first.");
        const result = await runExclusiveMaintenance(captured, (held) => held.discardExpiredPrelockPending(firstExpired.fundingOperationId));
        if (controller !== state.friday || captured !== scope()) throw new Error("Signer or deployment changed during expired intent recovery.");
        state.expiredPrelockBids = state.expiredPrelockBids.filter((entry) => entry.fundingOperationId !== result.fundingOperationId);
        message(`Discarded expired pre-lock intent ${short(result.fundingOperationId)}. The next bid will use a new operation.`, "success");
        await refresh();
      } });
  } else if (acknowledgementPending) {
    present("Imported · finishing settlement", `${acknowledgementPending} payment ${acknowledgementPending === 1 ? "is" : "items are"} already in this wallet. Only the exact terminal acknowledgement is retrying automatically.`, "attention");
  } else if (available) {
    present("Payment available · importing automatically", `${available} certified return or payout ${available === 1 ? "is" : "items are"} ready. This browser will import exact operations without another click.`, "attention");
  } else if (preparing) {
    present("Payment settlement in progress", `${preparing} exact payment ${preparing === 1 ? "is" : "items are"} awaiting terminal evidence. No completion or proof balance is claimed; automatic checks continue.`, "attention");
  } else if (historicalRecovery) {
    const remaining = recoveries.length - 1;
    present("Earlier bid recovery preserved",
      `The ${ui.formatSats(historicalRecovery.retainedBidAmount)} fake-sat bid operation for auction ${historicalRecovery.auctionId} remains as historical operation metadata, not a measured current proof balance.${remaining ? ` ${remaining} more retained operation${remaining === 1 ? " is" : "s are"} listed in Payment details.` : ""}`,
      "attention");
  } else if (settled) {
    present("Payments settled", `${settled} exact payment ${settled === 1 ? "has" : "operations have"} completed import and terminal acknowledgement.`, "settled");
  } else {
    present("Payments up to date", "No return, payout, or retained payment currently needs your action.", "settled");
  }
}
function participantStatus(auction, presentationView = state.auctionPresentationView || state.view) {
  if (!state.actor) return { tone: "", title: "Connect to participate", detail: "A Nostr identity and browser-owned Coco wallet are required." };
  if (auction.seller === state.actor) {
    if (auction.status !== "open") {
      if (!auction.winner) return { tone: "", title: "Closed without sale", detail: "No winner payment exists." };
      if (state.importedAuctionPayouts.has(auction.id)) return { tone: "leading", title: "Seller payout settled", detail: "The certified winning payment is in this browser-owned wallet and its exact terminal acknowledgement completed." };
      if (state.maintenanceChecking) return { tone: "warning", title: "Checking seller payout", detail: "Verifying a certified winner payment. This is not shown as imported until that import finishes." };
      const importStatus = state.auctionPayoutImportStatuses.get(auction.id);
      if (importStatus === "awaiting_terminal") return { tone: "warning", title: "Preparing seller payout", detail: "Consensus selected a winner. The exact terminal payout is still being certified; no wallet import is claimed yet." };
      if (importStatus === "wallet_imported_ack_pending") return { tone: "warning", title: "Seller payout imported · settlement pending", detail: "The wallet import succeeded. This browser is retrying only the exact terminal acknowledgement; it will not import the payment twice." };
      if (importStatus === "unknown") return { tone: "warning", title: "Payout status unavailable", detail: "The exact payout registry could not be verified. No import or completion is claimed." };
      return { tone: "warning", title: "Seller payout pending", detail: "Consensus has a winner. The browser imports the exact certified payout automatically; completion is shown only after import and acknowledgement." };
    }
    const payout = state.auctionPayoutAvailability.get(auction.id);
    if (payout === "missing") return { tone: "refund", title: "Offline bidding setup incomplete", detail: "Complete the one-time auction-scoped payout setup; no per-bid seller approval is used." };
    if (payout === "ready") return { tone: "", title: "You are the seller", detail: "The auction-scoped payout authorization lets bidders bid while you are offline." };
    return { tone: "", title: "You are the seller", detail: "Checking the auction-scoped offline bidding authorization." };
  }
  const bids = Object.values(presentationView?.state?.bids || {}).filter((bid) => bid.auction_id === auction.id && bid.bidder === state.actor).sort((a,b) => b.committed_at-a.committed_at);
  const latest = bids[0], leading = auction.leader_bid_id && presentationView?.state?.bids?.[auction.leader_bid_id]?.bidder === state.actor;
  const returnOperationId = latest?.integrated_funding_id;
  if (auction.status === "closed" && auction.winner === state.actor) return { tone: "leading", title: "You won", detail: "Consensus selected this identity. Seller payout uses a separate certified-import flow." };
  if (latest && leading && auction.status === "open") return { tone: "leading", title: "You’re leading", detail: `${ui.formatSats(auction.high_bid)} fake sats remain in the exact funded pool. Increasing your own leading bid is not supported yet.` };
  if (latest && !leading && returnOperationId && state.importedReturnOperations.has(returnOperationId)) return { tone: "leading", title: "Outbid return settled", detail: "This bid's certified return is in the browser-owned wallet and its exact terminal acknowledgement completed." };
  if (latest && !leading && returnOperationId && state.maintenanceChecking) return { tone: "warning", title: "Importing outbid return", detail: "The browser is checking this exact certified return automatically." };
  if (latest && !leading && returnOperationId && state.returnImportStatuses.get(returnOperationId) === "wallet_imported_ack_pending") return { tone: "warning", title: "Outbid return imported · settlement pending", detail: "The wallet import succeeded. This browser is retrying only the exact terminal acknowledgement; it will not import the return twice." };
  if (latest && !leading && returnOperationId && (state.returnImportStatuses.get(returnOperationId) === "unknown" || state.maintenanceError)) return { tone: "warning", title: "Automatic return delayed", detail: "The exact return remains preserved. This browser will retry with bounded backoff; no payment is repeated." };
  if (latest && !leading && auction.status === "open") return { tone: "refund", title: "You were outbid · return scheduled", detail: "This browser checks the exact certified return automatically every few seconds until it is imported." };
  if (latest && auction.status === "closed") return { tone: "refund", title: "Auction ended · return scheduled", detail: "The browser automatically imports only the exact certified terminal return after the committed outcome is verified." };
  if (auction.status === "open" && !auctionAcceptsNewBids(auction)) return { tone: "warning", title: "Auction ended · awaiting close", detail: "Committed bidding time has ended. New bids stay disabled while the close result is finalized." };
  return { tone: "", title: "Ready to bid", detail: "The next bid uses a fresh exact threshold-funded pool." };
}
function auctionNeedsAttention(auction) {
  if (!state.actor || auction.status === "open") return false;
  if (auction.seller === state.actor) {
    return Boolean(auction.winner) && !state.importedAuctionPayouts.has(auction.id);
  }
  const ownBids = Object.values(state.view?.state?.bids || {})
    .filter((bid) => bid.auction_id === auction.id && bid.bidder === state.actor)
    .sort((left, right) => Number(right.committed_at) - Number(left.committed_at));
  // A winning bidder receives no terminal return. Once consensus closes the
  // auction, the seller's separately certified payout is not bidder recovery.
  if (auction.winner === state.actor) return false;
  return ownBids.some((bid) => typeof bid.integrated_funding_id === "string"
    && !state.importedReturnOperations.has(bid.integrated_funding_id));
}
function auctionRenderKey(all) {
  const payouts = Array.from(state.auctionPayoutAvailability.entries()).sort(([left], [right]) => left.localeCompare(right));
  const payoutImports = Array.from(state.importedAuctionPayouts).sort();
  const returnImports = Array.from(state.importedReturnOperations).sort();
  const returnStatuses = Array.from(state.returnImportStatuses.entries()).sort(([left], [right]) => left.localeCompare(right));
  const bidRecoveries = Array.from(state.bidRecoveries.entries()).sort(([left], [right]) => left.localeCompare(right));
  const payment = paymentPolicyResult();
  return JSON.stringify({ actor: state.actor, query: state.query, showHistory: state.showHistory, auctions: all,
    bids: state.view?.state?.bids || {}, payouts, payoutImports, returnImports, returnStatuses, bidRecoveries,
    payment: payment.ok ? payment.policy : null });
}
function syncAuctionControls() {
  const presentationView = state.auctionPresentationView || state.view;
  for (const [actionKey, control] of state.auctionControls) {
    const auction = presentationView?.state?.auctions?.[control.auctionId];
    const unavailable = state.actionKeys.has(control.blockingKey || actionKey)
      || !auction || !auctionAcceptsNewBids(auction) || !state.publicStateAvailable;
    const leader = auction?.leader_bid_id ? presentationView?.state?.bids?.[auction.leader_bid_id] : null;
    const ownLeadingBid = Boolean(state.actor && leader?.bidder === state.actor);
    if (control.kind === "bid") {
      const recovery = state.bidRecoveries.get(control.auctionId);
      const parsed = ui.bidAmount(control.input.value, control.minimum, control.maximum);
      control.valid = parsed.ok;
      const showError = control.input.value !== "" && !parsed.ok;
      control.input.setCustomValidity?.(parsed.ok ? "" : parsed.reason);
      control.input.setAttribute("aria-invalid", String(showError));
      control.input.disabled = ownLeadingBid && !recovery;
      control.error.textContent = ownLeadingBid && !recovery ? "Increasing your own leading bid is not supported yet."
        : showError ? parsed.reason : (control.minimum === null ? "Committed minimum unavailable." : "");
      if (!state.actionKeys.has(actionKey)) control.button.textContent = recovery ? "Resume exact bid" : ownLeadingBid ? "You’re leading"
        : auctionAcceptsNewBids(auction) ? "Authorize funded bid" : "Bidding ended";
      control.button.disabled = recovery
        ? state.actionKeys.has(actionKey) || !state.friday || auction.seller === state.actor
        : ownLeadingBid || unavailable || !parsed.ok || !state.friday || !r20RuntimeReady() || auction.seller === state.actor;
    } else if (control.kind === "quick") {
      control.button.disabled = ownLeadingBid || unavailable || state.bidRecoveries.has(control.auctionId)
        || !state.friday || !r20RuntimeReady() || auction.seller === state.actor;
    } else {
      control.button.disabled = unavailable || !state.friday || !r20RuntimeReady() || auction.seller !== state.actor;
    }
  }
}
function syncAuctionCountdowns() {
  const presentationView = state.auctionPresentationView || state.view;
  for (const [auctionId, countdown] of state.auctionCountdowns) {
    const auction = presentationView?.state?.auctions?.[auctionId];
    const timer = ui.countdown(countdown.endTime, undefined, auction?.status !== "open");
    countdown.node.textContent = timer.label;
    countdown.node.className = timer.ended ? "timer-ended" : "";
    countdown.node.setAttribute("datetime", new Date(countdown.endTime * 1000).toISOString());
    if (countdown.finePrint) countdown.finePrint.textContent = auction?.status !== "open"
      ? "Consensus committed the closed auction state."
      : timer.ended
      ? "Awaiting the R20 deterministic close trigger and committed closed state."
      : "Consensus time controls anti-sniping extension and close eligibility.";
  }
}
function syncAuctionStatuses() {
  const presentationView = state.auctionPresentationView || state.view;
  for (const [auctionId, node] of state.auctionStatuses) {
    const auction = presentationView?.state?.auctions?.[auctionId];
    if (!auction) continue;
    const status = participantStatus(auction, presentationView);
    node.className = `status-card ${status.tone}`;
    if (node.children[0]) node.children[0].textContent = status.title;
    if (node.children[1]) node.children[1].textContent = status.detail;
  }
}
function resetAuctionRenderState() {
  state.auctionRenderKey = ""; state.auctionPresentationView = null;
  state.auctionControls.clear(); state.auctionCountdowns.clear(); state.auctionStatuses.clear();
}
function renderAuctions() {
  const target = byId("auctions");
  if (state.marketPhase === "loading" && !state.view) {
    resetAuctionRenderState();
    target.replaceChildren(empty("Loading auctions", "Reading committed consensus state from the application API."));
    target.setAttribute("aria-busy", "true"); return;
  }
  if (state.marketPhase === "error" && !state.view) {
    resetAuctionRenderState();
    const failure = empty("Auctions unavailable", state.marketError || "Committed state could not be read.");
    const retry = el("button", "button button-secondary", "Retry committed state"); retry.type = "button";
    retry.onclick = () => performAction("refresh", retry, "Retrying…", refresh).catch(() => undefined);
    failure.append(retry); target.replaceChildren(failure); target.setAttribute("aria-busy", "false");
    byId("market-meta").textContent = "Committed state unavailable · retry safely"; return;
  }
  const presentationView = state.view;
  state.auctionPresentationView = presentationView;
  const all = Object.values(presentationView?.state?.auctions || {}).sort((a,b) => b.created_at-a.created_at);
  const committedBids = Object.values(presentationView?.state?.bids || {});
  const active = document.activeElement, focusedBid = active?.dataset?.auctionBidId ? {
    auctionId: active.dataset.auctionBidId,
    start: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
    end: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
    direction: active.selectionDirection || "none",
  } : null;
  const focusedControl = active?.dataset?.auctionControl || "";
  let restoreBidFocus = null, restoreControlFocus = null;
  const draftPrefix = `${scope()}\u0000`;
  const openIds = new Set(all.filter((auction) => auction.status === "open").map((auction) => auction.id));
  const allIds = new Set(all.map((auction) => auction.id));
  for (const auctionId of state.openAuctionDetails) if (!allIds.has(auctionId)) state.openAuctionDetails.delete(auctionId);
  for (const key of state.bidDrafts.keys()) {
    if (key.startsWith(draftPrefix) && !openIds.has(key.slice(draftPrefix.length))) state.bidDrafts.delete(key);
  }
  const open = all.filter((auction) => auction.status === "open");
  const attention = all.filter((auction) => auction.status !== "open" && auctionNeedsAttention(auction));
  const history = all.filter((auction) => auction.status !== "open" && !auctionNeedsAttention(auction));
  const base = state.query ? all : (state.showHistory ? all : [...open, ...attention]);
  const auctions = ui.filterAuctions(base, state.query), renderKey = auctionRenderKey(all);
  const historyToggle = byId("auction-history-toggle");
  historyToggle.hidden = history.length === 0 || Boolean(state.query);
  historyToggle.disabled = history.length === 0;
  historyToggle.textContent = state.showHistory ? "Hide past auctions" : `Show past auctions (${history.length})`;
  historyToggle.setAttribute("aria-expanded", String(state.showHistory));
  target.setAttribute("aria-busy", "false");
  byId("market-meta").textContent = state.marketPhase === "stale"
    ? `${auctions.length} shown · last committed view retained · refresh failed`
    : `${open.length} live${attention.length ? ` · ${attention.length} need your attention` : ""} · app height ${presentationView?.state?.height ?? "—"}`;
  if (renderKey === state.auctionRenderKey) {
    syncAuctionControls(); syncAuctionCountdowns(); syncAuctionStatuses(); return;
  }
  state.auctionRenderKey = renderKey; state.auctionControls.clear(); state.auctionCountdowns.clear(); state.auctionStatuses.clear();
  target.replaceChildren();
  if (!auctions.length) {
    const title = state.query ? "No matching auctions" : (history.length ? "No live auctions right now" : "No live auctions yet");
    const detail = state.query ? "Clear the search to return to live auctions."
      : (history.length ? "Past auctions are hidden to keep this page focused. Use Show past auctions when you need them." : "Create the first signed auction.");
    target.append(empty(title, detail)); return;
  }
  for (const auction of auctions) {
    const card = el("article", "auction catalogue-card"), status = participantStatus(auction, presentationView),
      timer = ui.countdown(Number(auction.end_time), undefined, auction.status !== "open");
    card.dataset.auctionId = auction.id;
    const headingId = `auction-title-${auction.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    card.setAttribute("aria-labelledby", headingId);
    const auctionBids = committedBids.filter((bid) => bid.auction_id === auction.id);
    const media = el("div", "auction-media");
    media.append(el("span", `auction-state ${auction.status === "open" ? "open" : "closed"}`, auction.status.toUpperCase()));
    const imageSource = ui.imageURL(auction.image_url);
    if (imageSource.ok && imageSource.url) {
      const image = document.createElement("img"); image.className="auction-image"; image.src=imageSource.url;
      image.alt=`${auction.title} auction item`; image.loading="lazy"; image.decoding="async"; image.referrerPolicy="no-referrer"; media.append(image);
    } else media.append(el("span", "auction-placeholder", "P"));
    media.append(el("span", "auction-lot", `LOT ${short(auction.id)}`));

    const content = el("div", "auction-content");
    const kicker = el("div", "auction-kicker");
    kicker.append(el("span", "", `Seller ${short(auction.seller)}`), el("span", "", `${auctionBids.length} committed bid${auctionBids.length === 1 ? "" : "s"}`));
    const heading = el("h3", "", auction.title); heading.id = headingId;
    content.append(kicker, heading);
    content.append(el("p", "auction-description", auction.description || "No seller description was committed for this lot."));

    const price = Number(auction.high_bid) > 0 ? Number(auction.high_bid) : Number(auction.starting_bid);
    const priceRow = el("div", "price-row"), priceBlock = el("div", "bid-metric"), timerBlock = el("div", "countdown-metric");
    priceBlock.append(el("span", "", Number(auction.high_bid) > 0 ? "CURRENT COMMITTED BID" : "OPENING BID"), el("strong", "", ui.formatSats(price)), el("small", "", "fake sats"));
    const time = el("time", timer.ended ? "timer-ended" : "", timer.label);
    time.setAttribute("datetime", new Date(Number(auction.end_time) * 1000).toISOString());
    const countdown = { node: time, finePrint: null, endTime: Number(auction.end_time) };
    state.auctionCountdowns.set(auction.id, countdown);
    timerBlock.append(el("span", "", "COMMITTED DEADLINE"), time);
    priceRow.append(priceBlock, timerBlock); content.append(priceRow);

    const details = el("details", "auction-details"), detailsSummary = el("summary", "", "Lot details"), list = el("dl");
    detailsSummary.dataset.auctionControl = `details:${auction.id}`;
    if (focusedControl === detailsSummary.dataset.auctionControl) restoreControlFocus = detailsSummary;
    details.open = state.openAuctionDetails.has(auction.id);
    details.ontoggle = () => details.open ? state.openAuctionDetails.add(auction.id) : state.openAuctionDetails.delete(auction.id);
    [["Increment",ui.formatSats(Number(auction.min_increment))],["Reserve",auction.reserve ? ui.formatSats(Number(auction.reserve)) : "None"],["Extension",`${Math.max(0,Number(auction.end_time)-Number(auction.original_end_time))}s`],["Winner",short(auction.winner)]].forEach(([key,value]) => list.append(el("dt","",key),el("dd","",String(value))));
    details.append(detailsSummary, list);
    const participant = el("div", `status-card ${status.tone}`, "");
    participant.append(el("strong","",status.title),el("small","",status.detail));
    state.auctionStatuses.set(auction.id, participant);
    content.append(details, participant);
    const actions = el("div", "actions");
    if (auctionAcceptsNewBids(auction) && state.actor && auction.seller !== state.actor) {
      const minimum = ui.minimumBid(auction), payment = paymentPolicyResult();
      const maximum = payment.ok ? payment.policy.maxBidAmount : null, label = document.createElement("label"), input = document.createElement("input");
      const draftKey = `${scope()}\u0000${auction.id}`;
      const inputId = `bid-${headingId}`, errorId = `error-${inputId}`;
      label.htmlFor=inputId; label.append(el("span","field-help",minimum === null ? "Bid minimum unavailable" : `Your exact bid · minimum ${ui.formatSats(minimum)}`));
      input.id=inputId; input.type="text"; input.pattern="[0-9]*"; input.autocomplete="off"; input.spellcheck=false; input.inputMode="numeric"; input.dataset.auctionBidId=auction.id; input.value=state.bidDrafts.get(draftKey) || "";
      input.setAttribute("aria-describedby", errorId); label.append(input);
      const error = el("small", "bid-error", ""); error.id=errorId; error.setAttribute("role", "alert"); label.append(error);
      const recovery = state.bidRecoveries.get(auction.id);
      const button = el("button","button button-primary",recovery ? "Resume exact bid" : "Authorize funded bid"); button.type="button";
      const actionKey = `bid:${auction.id}`;
      const progress = el("div", "bid-progress"); progress.hidden = true; progress.setAttribute("aria-hidden", "true");
      progress.setAttribute("role", "status"); progress.setAttribute("aria-live", "polite");
      const progressPhase = el("strong"), progressDetail = el("span"), progressElapsed = el("small");
      progressElapsed.setAttribute("aria-hidden", "true"); progress.append(progressPhase, progressDetail, progressElapsed);
      const control = { kind: "bid", auctionId: auction.id, button, input, error, minimum, maximum, valid: false,
        progress, progressPhase, progressDetail, progressElapsed };
      const validate = () => {
        if (input.value === "") state.bidDrafts.delete(draftKey);
        else state.bidDrafts.set(draftKey, input.value);
        syncAuctionControls();
      };
      input.oninput=validate;
      const suggestions = el("div", "bid-suggestions"); suggestions.setAttribute("aria-label", "Bid amount shortcuts");
      for (const suggestion of ui.bidSuggestions(auction, maximum)) {
        const quick = el("button", "bid-suggestion", `${suggestion.label} · ${ui.formatSats(suggestion.amount)}`); quick.type="button";
        quick.setAttribute("aria-label", `${suggestion.label}: bid ${ui.formatSats(suggestion.amount)} fake sats`);
        quick.dataset.auctionControl=`quick:${auction.id}:${suggestion.amount}`;
        if (focusedControl === quick.dataset.auctionControl) restoreControlFocus = quick;
        quick.onclick=()=>{input.value=String(suggestion.amount);input.oninput();input.focus();}; suggestions.append(quick);
        state.auctionControls.set(`quick:${auction.id}:${suggestion.amount}`, { kind: "quick", auctionId: auction.id, button: quick, blockingKey: actionKey });
      }
      button.dataset.auctionControl=`place:${auction.id}`;
      if (focusedControl === button.dataset.auctionControl) restoreControlFocus = button;
      button.onclick=()=>performAction(actionKey,button,recovery ? "Resuming exact bid…" : "Authorizing & funding…",async()=>{
        const bidProgress = startBidProgress(control);
        try {
          const currentRecovery=state.bidRecoveries.get(auction.id);
          const parsed=currentRecovery ? { ok: true, amount: currentRecovery.retainedBidAmount }
            : ui.bidAmount(input.value,minimum,maximum);if(!parsed.ok)throw new Error(parsed.reason);
          message(currentRecovery
            ? `Resuming only retained operation ${short(currentRecovery.fundingOperationId)}. No second payment will be created.`
            : "Authorizing one exact funded bid. Your signer may ask for approval; do not retry while this control is busy.","info");
          await placeBid(auction.id,parsed.amount,(phase)=>bidProgress.update(phase));
        } finally { bidProgress.stop(); }
      }).catch(()=>undefined);
      state.auctionControls.set(actionKey, control); validate();
      if (focusedBid?.auctionId === auction.id) restoreBidFocus = input;
      actions.append(suggestions,label,button,progress);
    }
    if (auction.status === "open" && auction.seller === state.actor
      && state.auctionPayoutAvailability.get(auction.id) === "missing") {
      const setup = el("button", "button button-secondary", "Complete offline bidding setup");
      setup.type = "button";
      setup.dataset.auctionControl=`payout:${auction.id}`;
      if (focusedControl === setup.dataset.auctionControl) restoreControlFocus = setup;
      setup.onclick = () => performAction(`auction-payout:${auction.id}`, setup, "Authorizing…", async () => {
        await authorizeCommittedAuctionPayout(auction);
        message(`Offline bidding is ready for auction ${auction.id}; bidders no longer need this seller tab.`, "success");
        renderAuctions();
        await refresh();
      }).catch(() => undefined);
      state.auctionControls.set(`auction-payout:${auction.id}`, { kind: "payout", auctionId: auction.id, button: setup });
      actions.append(setup);
    }
    if (auction.status === "open") { countdown.finePrint = el("small","fine-print"); actions.append(countdown.finePrint); }
    content.append(actions); card.append(media, content); target.append(card);
  }
  syncAuctionControls(); syncAuctionCountdowns(); syncAuctionStatuses();
  if (restoreBidFocus) {
    restoreBidFocus.focus?.({ preventScroll: true });
    if (focusedBid.start !== null && focusedBid.end !== null && typeof restoreBidFocus.setSelectionRange === "function") {
      const length = restoreBidFocus.value.length;
      restoreBidFocus.setSelectionRange(Math.min(focusedBid.start, length), Math.min(focusedBid.end, length), focusedBid.direction);
    }
  } else restoreControlFocus?.focus?.({ preventScroll: true });
}
function renderValidators() {
  const target=byId("validators"), focusedControl=document.activeElement?.dataset?.validatorControl || ""; target.replaceChildren();
  if (state.validatorPhase === "loading") {
    target.append(empty("Loading validators", "Reading the pinned replica's commit snapshot.")); target.setAttribute("aria-busy", "true"); return;
  }
  if (state.validatorPhase === "error") {
    byId("validator-summary").textContent = "Validator observations unavailable · auction catalogue remains independently readable";
    target.append(empty("Validator observations unavailable", state.validatorError || "The pinned replica's commit snapshot could not be read."));
    target.setAttribute("aria-busy", "false"); return;
  }
  const validators=state.validators?.validators || [], validatorKeys=new Set(validators.map((validator)=>`slot:${validator.slot}`));
  for (const key of state.openValidatorDetails) if (!validatorKeys.has(key)) state.openValidatorDetails.delete(key);
  let restoreFocus=null; target.setAttribute("aria-busy","false");
  byId("validator-summary").textContent = ui.validatorSummary(validators,state.validators?.observed_at);
  for (const validator of validators) {
    const evidence=ui.validatorEvidence(validator), card=el("article",`validator ${evidence.state}`), heading=el("strong");
    heading.append(document.createTextNode(validator.moniker || `Validator ${validator.slot}`),el("i","dot"));
    const validatorKey=`slot:${validator.slot}`, technical=el("details","validator-technical"), summary=el("summary","","Technical details");
    technical.open=state.openValidatorDetails.has(validatorKey);
    technical.ontoggle=()=>technical.open ? state.openValidatorDetails.add(validatorKey) : state.openValidatorDetails.delete(validatorKey);
    summary.dataset.validatorControl=`details:${validatorKey}`;
    if (focusedControl === summary.dataset.validatorControl) restoreFocus=summary;
    technical.append(summary,el("small","",`Validator ${validator.slot} · node ${short(validator.node_id)}`),el("small","",`app ${short(validator.app_hash)}`));
    card.append(heading,el("span","validator-result",evidence.label),el("small","validator-commit",evidence.detail),technical); target.append(card);
  }
  restoreFocus?.focus?.({ preventScroll: true });
}
function render() { updateControls(); renderWallet(); renderAuctions(); renderValidators(); }

const bidProgressCopy = Object.freeze({
  waiting_for_wallet: ["Waiting for wallet…", "Waiting for the browser's single-operation wallet lane."],
  checking_identity: ["Checking identity…", "Revalidating the connected signer and reviewed deployment."],
  checking_auction: ["Checking auction…", "Reading the latest trusted auction and payout authorization."],
  opening_wallet: ["Opening wallet…", "Opening the exact browser wallet under its single-operation lock."],
  preparing_funds: ["Preparing payment…", "Persisting the exact payment operation before mint activity."],
  reserving_funds: ["Reserving funds…", "Locking the exact fake-sat amount and preparing its return path."],
  building_authorization: ["Building authorization…", "Building and verifying the threshold funding envelope."],
  contacting_authority: ["Contacting authority…", "Submitting the exact prepared funding envelope."],
  awaiting_intent_signature: ["Signer · bid intent…", "Approve the exact bid intent in your signer."],
  awaiting_funding_signature: ["Signer · funding authorization…", "Approve the exact funding authorization in your signer."],
  awaiting_bid_signature: ["Signer · final bid…", "Approve the exact prepared bid in your signer."],
  awaiting_signature: ["Waiting for signer…", "Approve the exact request in your signer if it asks."],
  confirming_consensus: ["Confirming bid…", "Checking the same signed bid until its committed outcome is known."],
  resuming_exact: ["Resuming exact bid…", "Continuing only the retained operation; no replacement payment is created."],
  verifying_committed_state: ["Verifying committed state…", "Reading committed consensus state before showing the outcome."],
  post_commit_refresh: ["Refreshing committed view…", "Updating the catalogue from the committed result before payment maintenance finishes."],
  preserving_recovery: ["Preserving recovery state…", "Keeping the exact operation recoverable before another action is allowed."],
});
function startBidProgress(control) {
  const startedAt = readinessNow(), generation = state.generation, capturedScope = scope(), controller = state.friday;
  let active = true, currentPhase = "", phaseStartedAt = startedAt, slowGuidancePhase = "";
  const current = () => active && generation === state.generation && capturedScope === scope()
    && controller === state.friday && control.button.isConnected;
  const timing = (now) => {
    const total = Math.max(0, Math.floor((now - startedAt) / 1000));
    const stage = Math.max(0, Math.floor((now - phaseStartedAt) / 1000));
    return `${total}s total · ${stage}s this stage`;
  };
  const tick = () => {
    if (!current()) return;
    const now = readinessNow(), stageElapsed = Math.max(0, Math.floor((now - phaseStartedAt) / 1000));
    control.progressElapsed.textContent = timing(now);
    if (stageElapsed >= 8 && slowGuidancePhase !== currentPhase) {
      slowGuidancePhase = currentPhase;
      const copy = bidProgressCopy[currentPhase];
      if (copy) control.progressDetail.textContent = `${copy[1]} Still working—keep this tab open and do not click again.`;
    }
  };
  const timer = setInterval(tick, 1000);
  const update = (phase) => {
    const copy = bidProgressCopy[phase];
    if (!copy || !current()) return;
    const now = readinessNow();
    if (phase !== currentPhase) { currentPhase = phase; phaseStartedAt = now; }
    control.button.textContent = copy[0];
    control.progress.hidden = false; control.progress.setAttribute("aria-hidden", "false");
    control.progressPhase.textContent = copy[0].replace(/…$/, "");
    control.progressDetail.textContent = `${copy[1]} Please do not retry while this bid is in progress.`;
    control.progressElapsed.textContent = timing(now);
    message(`${copy[1]} Please do not retry while this bid is in progress.`, "info");
  };
  update("waiting_for_wallet");
  return Object.freeze({ update, stop() {
    active = false; clearInterval(timer);
    control.progress.hidden = true; control.progress.setAttribute("aria-hidden", "true");
  } });
}

async function performAction(key, button, pendingLabel, action) {
  if (state.actionKeys.has(key)) return;
  const presentationGeneration = state.generation, presentationScope = scope(), presentationController = state.friday;
  const mayPresent = () => key === "identity:connect" || (presentationGeneration === state.generation
    && presentationScope === scope() && presentationController === state.friday);
  state.actionKeys.add(key); const prior=button?.textContent;
  if(button){button.disabled=true;button.textContent=pendingLabel;button.dataset.loading="true";button.setAttribute("aria-busy","true");}
  if (key === "identity:connect") updateControls();
  try { return await action(); } catch(error) { if (mayPresent()) message(error.message,"error"); throw error; }
  finally { state.actionKeys.delete(key); if(button){button.textContent=prior;button.dataset.loading="false";button.setAttribute("aria-busy","false");updateControls();syncAuctionControls();} }
}
async function placeBid(auctionId, amount, onProgress = () => {}) {
  const resume = state.bidRecoveries.get(auctionId);
  if (!resume) { requireR20Ready(); requirePublicStateReady(); }
  if(!state.friday) throw new Error("Connect a signer first.");
  const controller = state.friday, captured = scope();
  const progress = (phase) => { try { onProgress(phase); } catch {} };
  progress("waiting_for_wallet");
  let result=await runExclusiveMaintenance(captured, (held) => {
    if (resume) {
      if (typeof held.resumeBid !== "function") throw new Error("Exact bid resume is unavailable in this browser release.");
      progress("resuming_exact");
      return held.resumeBid(resume.fundingOperationId, (event) => progress(event?.phase));
    }
    // The queue may outlive readiness or the committed view. Recheck only new
    // bid admission here; retained exact maintenance remains available.
    requireR20Ready(); requirePublicStateReady();
    const payment = paymentPolicyResult(); if (!payment.ok) throw new Error(payment.reason);
    const auction=state.view?.state?.auctions?.[auctionId]; if(!auction||auction.status!=="open") throw new Error("Auction is not open in committed state.");
    const bid=ui.bidAmount(amount,ui.minimumBid(auction),payment.policy.maxBidAmount); if(!bid.ok)throw new Error(bid.reason);
    const consensusTime=Number(state.view?.state?.last_consensus_time), endTime=Number(auction.end_time);
    if(!Number.isSafeInteger(consensusTime)||!Number.isSafeInteger(endTime)||consensusTime>=endTime)throw new Error("Auction bidding has ended in committed consensus time.");
    const leader=auction.leader_bid_id?state.view?.state?.bids?.[auction.leader_bid_id]:null; if(leader?.bidder===state.actor) throw new Error("Own raises remain fail-closed until full-pool key continuity is proven.");
    const timing=ui.payoutWindow(Number(auction.original_end_time),state.config?.auction_policy); if(!timing.ok) throw new Error(timing.reason);
    progress("checking_identity");
    return held.placeBid({auctionId,bidAmount:amount,fullPoolAmount:amount,reservedPoolAmount:amount,replacesBidId:auction.leader_bid_id||"",locktime:timing.validUntil},
      (event) => progress(event?.phase));
  });
  if (controller !== state.friday || captured !== scope()) throw new Error("Signer or deployment changed during bid authorization.");
  if ((result.status === "admitted" || result.status === "rejected_return") && result.recoveredBidAmount === undefined) {
    const draftKey = `${captured}\u0000${auctionId}`, exactDraft = String(amount);
    if (state.bidDrafts.get(draftKey) === exactDraft) state.bidDrafts.delete(draftKey);
    const control = state.auctionControls.get(`bid:${auctionId}`);
    if (control?.kind === "bid" && control.input.value === exactDraft) control.input.value = "";
  }
  if (result.status === "admitted" || result.status === "rejected_return") {
    progress("verifying_committed_state");
  } else {
    progress("preserving_recovery");
  }
  const recovered=result.recoveredBidAmount===undefined?"":`Recovered the prior ${ui.formatSats(result.recoveredBidAmount)} bid; the new ${ui.formatSats(amount)} draft was not submitted. `;
  const presentations = {
    admitted: { tone: "success", text: `${recovered}Bid committed${result.committedHeight ? ` at height ${result.committedHeight}` : ""}. You can verify leadership in the refreshed committed state.` },
    prepared: { tone: "warning", text: `${recovered}Bid ${short(result.fundingOperationId)} is prepared but not yet committed. Keep its exact amount; any changed draft recovers this operation first.` },
    rejected_return: { tone: "warning", text: `${recovered}Bid was not admitted${result.committedHeight ? ` at height ${result.committedHeight}` : ""}. Its certified return will be imported after terminal verification.` },
    unknown: { tone: "warning", text: `${recovered}Bid ${short(result.fundingOperationId)} has an unknown outcome. Any changed draft recovers this operation before a new bid is allowed.` },
    resume_required: { tone: "warning", text: `Payment operation ${short(result.fundingOperationId)} is retained under its original ${ui.formatSats(result.retainedBidAmount)} fake-sat bid. No second payment was created. Use Resume exact bid to continue only this operation.` },
    seller_plan_pending: { tone: "warning", text: `This auction has no registered offline payout authorization. Bid ${short(result.fundingOperationId)} remains pre-lock and cannot proceed.` },
  };
  const presentation = presentations[result.status] || { tone: "warning", text: `Bid ${short(result.fundingOperationId)} requires recovery.` };
  if (result.status === "resume_required") state.bidRecoveries.set(auctionId, {
    auctionId, fundingOperationId: result.fundingOperationId, retainedBidAmount: result.retainedBidAmount,
    recoveryStage: result.recoveryStage,
  });
  else if (result.status === "admitted" || result.status === "rejected_return") state.bidRecoveries.delete(auctionId);
  if (result.status === "admitted" || result.status === "rejected_return") {
    progress("post_commit_refresh");
    try {
      const priorRefresh = state.refreshPromise;
      if (priorRefresh) await priorRefresh.catch(() => undefined);
      await refresh();
    }
    catch (error) {
      const committed = result.committedHeight ? ` at height ${result.committedHeight}` : "";
      throw new Error(`The funding authority reported ${result.status}${committed}, but the refreshed committed state is unavailable. Do not submit another bid; exact recovery remains preserved. ${error.message}`);
    }
    message(presentation.text, presentation.tone);
  } else {
    message(presentation.text, presentation.tone);
    const priorRefresh = state.refreshPromise;
    if (priorRefresh) await priorRefresh.catch(() => undefined);
    await refresh();
    if (controller !== state.friday || captured !== scope()) {
      throw new Error("Signer or deployment changed during bid reconciliation.");
    }
    if (result.status === "resume_required"
      && committedBidForOperationExact(auctionId, result.fundingOperationId, result.retainedBidAmount)) {
      state.bidRecoveries.delete(auctionId);
      state.bidDrafts.delete(`${captured}\u0000${auctionId}`);
      result = { status: "admitted", fundingOperationId: result.fundingOperationId };
      renderAuctions();
      message("Bid committed and verified in refreshed canonical state. No resume is needed.", "success");
    }
  }
  return result;
}
async function authorizeCommittedAuctionPayout(auction) {
  requireR20Ready(); requirePublicStateReady(); if (!state.friday) throw new Error("Connect a signer first.");
  const controller = state.friday, captured = scope();
  if (!auction || auction.status !== "open" || auction.seller !== state.actor) throw new Error("Connect the open auction's seller first.");
  const payment = paymentPolicyResult(); if (!payment.ok) throw new Error(payment.reason);
  const startingBid = exactInteger(auction.starting_bid, "Starting bid", 1, payment.policy.maxBidAmount);
  const minIncrement = exactInteger(auction.min_increment, "Minimum increment", 1, payment.policy.maxBidAmount);
  const reserve = exactInteger(auction.reserve, "Reserve", 0, payment.policy.maxBidAmount);
  const originalEndTime = exactInteger(auction.original_end_time, "Original end time");
  const timing = ui.payoutWindow(originalEndTime, state.config?.auction_policy);
  if (!timing.ok) throw new Error(timing.reason);
  await runExclusiveMaintenance(captured, async (held) => {
    const existing = await held.readAuctionPayout(auction.id);
    if (existing === null) {
      await held.authorizeAuctionPayout({ auctionId: auction.id, startingBid, minIncrement, reserve,
        originalEndTime, maximumEndTime: timing.maximumEndTime, maximumPayout: payment.policy.maxPayout, validUntil: timing.validUntil });
    }
  });
  if (controller !== state.friday || captured !== scope()) throw new Error("Signer or deployment changed during payout authorization.");
  state.auctionPayoutAvailability.set(auction.id, "ready");
}
async function servicePayments() {
  if (!state.friday) throw new Error("Connect a signer first.");
  let failure = null, refreshFailure = null;
  try { await runMaintenance(scope(), { force: true,
    repairAcknowledgements: (held) => repairBidReturnAcknowledgements(held,
      outbidReturnOperationIds({ includeImported: true })) }); }
  catch (error) { failure = error; }
  // A batch may durably import later exact operations while preserving one
  // failed earlier entry. Always refresh the wallet and exact status labels
  // before surfacing that remaining failure.
  try { await refresh(); }
  catch (error) { refreshFailure = error; }
  if (failure && refreshFailure) throw new AggregateError([failure, refreshFailure], `${failure.message} Wallet/status refresh also failed: ${refreshFailure.message}`);
  if (failure) throw failure;
  if (refreshFailure) throw refreshFailure;
}

byId("login").onclick=(event)=>performAction("identity:connect",event.currentTarget,"Connecting…",connect).catch(()=>undefined);
byId("disconnect").onclick=()=>{disconnect();render();message("Disconnected. Reconnect to recover returns and payouts.");};
byId("demo-login").onclick=(event)=>performAction("identity:connect",event.currentTarget,"Connecting…",connectDemo).catch(()=>undefined);
byId("nip46-open").onclick=()=>openIdentityPanel("nip46");
byId("nip46-cancel").onclick=cancelClavePairing;
byId("nip46-connect").onclick=(event)=>performAction("identity:connect",event.currentTarget,"Waiting for Clave…",connectClave).catch(()=>undefined);
byId("dev-nsec-open").onclick=()=>openIdentityPanel("dev-nsec");
byId("dev-nsec-cancel").onclick=()=>{byId("dev-nsec").value="";hideIdentityPanels();};
byId("dev-nsec-connect").onclick=(event)=>performAction("identity:connect",event.currentTarget,"Connecting locally…",connectDevNsec).catch(()=>undefined);
byId("refresh").onclick=(event)=>performAction("refresh",event.currentTarget,"Refreshing committed state…",refresh).catch(()=>undefined);
byId("auction-search").oninput=(event)=>{state.query=event.target.value;renderAuctions();};
byId("auction-history-toggle").onclick=()=>{state.showHistory=!state.showHistory;renderAuctions();};
byId("duration").oninput=()=>setDurationError();
byId("duration-unit").onchange=()=>{setDurationError();updateDurationControl();};
for(const [id,seconds] of durationPresets) byId(id).onclick=()=>applyDurationPreset(seconds);
byId("faucet").onclick=(event)=>performAction("fund",event.currentTarget,"Funding…",async()=>{
  requireR20Ready(); requirePublicStateReady(); if(!state.friday) throw new Error("Connect a signer first.");
  const controller=state.friday,captured=scope();
  const policy=controller.fundingPolicy(), parsed=ui.fundingAmount(byId("faucet-amount").value,policy.maxPerRequest); if(!parsed.ok) throw new Error(parsed.reason);
  const result=await runExclusiveMaintenance(captured,async(held)=>{const pending=await held.pendingFakeFunding();if(pending&&(pending.amount!==parsed.amount||pending.policyDigest!==policy.digest))throw new Error(`Unresolved funding ${short(pending.operationId)} must retry its original amount and policy.`);return held.fundFake(parsed.amount);});
  if(controller!==state.friday||captured!==scope())throw new Error("Signer or deployment changed during fake funding.");
  message(`${ui.formatSats(parsed.amount)} fake sats finalized in Coco (${short(result.operationId)}).`,"success"); byId("faucet-amount").value=""; await refresh();
}).catch(()=>undefined);
byId("create-form").onsubmit=(event)=>{event.preventDefault();return performAction("create",byId("create-submit"),"Signing…",async()=>{
  requireR20Ready(); requirePublicStateReady(); if(!state.friday) throw new Error("Connect a signer first.");
  const retained=readListingAttempt();
  if(retained){await finishListingAttempt(retained);return;}
  const parsedDuration=ui.durationSeconds(byId("duration").value,byId("duration-unit").value,state.config?.auction_policy);
  if(!parsedDuration.ok){setDurationError(parsedDuration.reason);byId("duration").focus();throw new Error(parsedDuration.reason);} setDurationError();
  const payment=paymentPolicyResult(); if(!payment.ok)throw new Error(payment.reason);
  const duration=parsedDuration.seconds,starting=exactInteger(byId("starting").value,"Starting bid",1,payment.policy.maxBidAmount),increment=exactInteger(byId("increment").value,"Minimum increment",1,payment.policy.maxBidAmount),reserve=byId("reserve").value.trim()===""?0:exactInteger(byId("reserve").value,"Reserve",0,payment.policy.maxBidAmount);
  const image=ui.imageURL(byId("image").value); if(!image.ok) throw new Error(image.reason);
  const controller=state.friday,captured=scope();
  const sellerPaymentPublicKey=await runExclusiveMaintenance(captured,(held)=>held.sellerPaymentPublicKey());
  if(controller!==state.friday||captured!==scope())throw new Error("Signer or deployment changed during listing preparation.");
  const id=`auction-${Date.now()}`,listing={auction_id:id,title:byId("title").value,description:byId("description").value,image_url:image.url,duration_seconds:duration,starting_bid:starting,min_increment:increment,reserve,funding_mode:"threshold_sigall_v1",seller_coco_payment_public_key:sellerPaymentPublicKey};
  const signed=await sign(28640,[["t","plebeian-auctions-poc"],["auction",id]],listing);
  const attempt={schema:listingAttemptSchema,scope:scope(),actor:state.actor,auctionId:id,listing,signed,submitted:false,minimumHeight:null};
  writeListingAttempt(attempt);
  await finishListingAttempt(attempt);
}).catch(()=>undefined);};

(async function boot(){
  try { await refresh(); }
  catch(error){message(error.message,"error");updateControls();}
})();
setInterval(()=>refresh().catch(()=>undefined),4000);
setInterval(()=>{if(state.view)syncAuctionCountdowns();},1000);
