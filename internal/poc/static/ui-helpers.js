(function attachPlebeianUI(root, factory) {
  const helpers = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  root.PlebeianUI = helpers;
})(typeof window !== "undefined" ? window : globalThis, function buildPlebeianUI() {
  function formatSats(value) { return Number.isSafeInteger(value) ? value.toLocaleString("en-US") : "—"; }
  function formatTime(unixSeconds) {
    const value = Number(unixSeconds);
    if (!Number.isFinite(value) || value <= 0) return "Unknown";
    return new Date(value * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
  function countdown(endTime, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!Number.isSafeInteger(endTime) || endTime <= 0 || !Number.isFinite(nowSeconds)) return { ended: false, label: "Time unknown" };
    const remaining = endTime - nowSeconds;
    if (remaining <= 0) return { ended: true, label: "Ended · awaiting committed close" };
    const hours = Math.floor(remaining / 3600), minutes = Math.floor((remaining % 3600) / 60), seconds = remaining % 60;
    return { ended: false, label: hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m ${String(seconds).padStart(2, "0")}s remaining` };
  }
  function minimumBid(auction) {
    const high = Number(auction?.high_bid), start = Number(auction?.starting_bid), increment = Number(auction?.min_increment);
    if (![high, start, increment].every(Number.isSafeInteger) || start < 1 || increment < 1 || high < 0) return null;
    if (high === 0) return start;
    return high <= Number.MAX_SAFE_INTEGER - increment ? high + increment : null;
  }
  function filterAuctions(auctions, query) {
    const needle = String(query || "").trim().toLowerCase();
    return needle ? auctions.filter((auction) => `${auction.title || ""} ${auction.seller || ""}`.toLowerCase().includes(needle)) : auctions;
  }
  function fundingAmount(raw, maximum) {
    const value = String(raw ?? "");
    if (!/^[1-9][0-9]*$/.test(value)) return { ok: false, reason: "Enter a positive whole number." };
    const amount = Number(value);
    if (!Number.isSafeInteger(amount)) return { ok: false, reason: "Amount exceeds the safe integer range." };
    if (!Number.isSafeInteger(maximum) || maximum < 1 || amount > maximum) return { ok: false, reason: `Runtime policy allows at most ${formatSats(maximum)} fake sats per request.` };
    return { ok: true, amount };
  }
  function bidAmount(raw, minimum) {
    const value = String(raw ?? "");
    if (!/^[1-9][0-9]*$/.test(value)) return { ok: false, reason: "Enter a positive whole-number bid." };
    const amount = Number(value);
    if (!Number.isSafeInteger(amount)) return { ok: false, reason: "Bid exceeds the safe integer range." };
    if (!Number.isSafeInteger(minimum) || minimum < 1) return { ok: false, reason: "Committed bid minimum is unavailable." };
    if (amount < minimum) return { ok: false, reason: `Bid must be at least ${formatSats(minimum)} fake sats.` };
    return { ok: true, amount };
  }
  function imageURL(raw) {
    const value = String(raw ?? "").trim();
    if (value === "") return { ok: true, url: "" };
    if (value.length > 512) return { ok: false, reason: "Image URL may not exceed 512 characters." };
    let parsed;
    try { parsed = new URL(value); }
    catch { return { ok: false, reason: "Image URL is invalid." }; }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
      return { ok: false, reason: "Image URL must be HTTPS, contain no credentials, and contain no fragment." };
    }
    return { ok: true, url: value };
  }
  function scopeKey(actor, deployment) { return actor && deployment ? `${deployment}\u0000${actor}` : ""; }
  function validatorEvidence(validator) {
    const observed = String(validator?.observation || "").includes("canonical commit signature observed");
    if (!observed) return { state: "unknown", label: "Signature unknown", detail: validator?.online ? "RPC reachable · signature not evaluated" : "RPC unavailable · signature unknown" };
    return validator.online ? { state: "observed", label: "Signed commit", detail: `Commit ${formatSats(validator.canonical_commit_height)}` } : { state: "absent", label: "Signature absent", detail: "No signature in observed commit" };
  }
  return { formatSats, formatTime, countdown, minimumBid, filterAuctions, fundingAmount, bidAmount, imageURL, scopeKey, validatorEvidence };
});
