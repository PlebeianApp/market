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
  function countdown(endTime, nowSeconds = Math.floor(Date.now() / 1000), closed = false) {
    if (closed) return { ended: true, label: "Closed · committed" };
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
  function bidSuggestions(auction, maximum) {
    const minimum = minimumBid(auction), increment = Number(auction?.min_increment);
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(increment) || increment < 1
      || !Number.isSafeInteger(maximum) || maximum < minimum) return [];
    return [["Next", 0], ["Jump", 2], ["Big move", 9]].flatMap(([label, steps]) => {
      if (steps > Math.floor((Number.MAX_SAFE_INTEGER - minimum) / increment)) return [];
      const amount = minimum + steps * increment;
      return amount <= maximum ? [{ label, amount }] : [];
    });
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
  function bidAmount(raw, minimum, maximum) {
    const value = String(raw ?? "");
    if (!/^[1-9][0-9]*$/.test(value)) return { ok: false, reason: "Enter a positive whole-number bid." };
    const amount = Number(value);
    if (!Number.isSafeInteger(amount)) return { ok: false, reason: "Bid exceeds the safe integer range." };
    if (!Number.isSafeInteger(minimum) || minimum < 1) return { ok: false, reason: "Committed bid minimum is unavailable." };
    if (amount < minimum) return { ok: false, reason: `Bid must be at least ${formatSats(minimum)} fake sats.` };
    if (!Number.isSafeInteger(maximum) || maximum < minimum) return { ok: false, reason: "The reviewed auction payment limit is unavailable." };
    if (amount > maximum) return { ok: false, reason: `This candidate allows bids up to ${formatSats(maximum)} fake sats.` };
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
  function formatDuration(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds < 1) return "unknown duration";
    const parts = [];
    const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60), remainder = seconds % 60;
    if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    if (remainder) parts.push(`${remainder} second${remainder === 1 ? "" : "s"}`);
    return parts.join(" ");
  }
  function auctionPolicy(value) {
    if (!value || value.schema !== "PLEBEIAN_AUCTION_TIMING_POLICY_V1") {
      return { ok: false, reason: "The backend auction timing policy is unavailable." };
    }
    const keys = ["min_duration_seconds", "max_duration_seconds", "default_duration_seconds", "late_bid_window_seconds",
      "late_bid_extension_seconds", "max_total_extension_seconds", "emergency_recovery_seconds"];
    const expectedKeys = ["schema", ...keys].sort();
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
      return { ok: false, reason: "The backend auction timing policy has unexpected fields." };
    }
    if (!keys.every((key) => Number.isSafeInteger(value[key]))) {
      return { ok: false, reason: "The backend auction timing policy is malformed." };
    }
    const policy = {
      minDurationSeconds: value.min_duration_seconds,
      maxDurationSeconds: value.max_duration_seconds,
      defaultDurationSeconds: value.default_duration_seconds,
      lateBidWindowSeconds: value.late_bid_window_seconds,
      lateBidExtensionSeconds: value.late_bid_extension_seconds,
      maxTotalExtensionSeconds: value.max_total_extension_seconds,
      emergencyRecoverySeconds: value.emergency_recovery_seconds,
    };
    if (policy.minDurationSeconds < 1 || policy.maxDurationSeconds < policy.minDurationSeconds
      || policy.defaultDurationSeconds < policy.minDurationSeconds || policy.defaultDurationSeconds > policy.maxDurationSeconds
      || policy.lateBidWindowSeconds < 1 || policy.lateBidExtensionSeconds < 1
      || policy.maxTotalExtensionSeconds < policy.lateBidExtensionSeconds || policy.emergencyRecoverySeconds < 1) {
      return { ok: false, reason: "The backend auction timing policy is inconsistent." };
    }
    const reviewedProfile = policy.minDurationSeconds === 3
      && (policy.maxDurationSeconds === 3600 || policy.maxDurationSeconds === 604800)
      && policy.defaultDurationSeconds === 600
      && policy.lateBidWindowSeconds === 180
      && policy.lateBidExtensionSeconds === 180
      && policy.maxTotalExtensionSeconds === 1800
      && policy.emergencyRecoverySeconds === 900;
    if (!reviewedProfile) {
      return { ok: false, reason: "The backend auction timing policy is not a reviewed one-hour or seven-day profile." };
    }
    return { ok: true, policy };
  }
  function auctionPaymentPolicy(value) {
    if (!value || value.schema !== "PLEBEIAN_FRIDAY_AUCTION_PAYMENT_POLICY_V1"
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["max_bid_amount", "max_payout", "schema"])
      || value.max_bid_amount !== 50000 || value.max_payout !== 50000) {
      return { ok: false, reason: "The reviewed auction payment policy is unavailable." };
    }
    return { ok: true, policy: { maxBidAmount: value.max_bid_amount, maxPayout: value.max_payout } };
  }
  function durationBounds(unit, value) {
    const parsed = auctionPolicy(value);
    if (!parsed.ok) return parsed;
    if (unit === "seconds") return { ok: true, minimum: parsed.policy.minDurationSeconds, maximum: parsed.policy.maxDurationSeconds };
    const divisor = unit === "minutes" ? 60 : unit === "days" ? 86400 : 0;
    if (!divisor) return { ok: false, reason: "Choose seconds, minutes, or days for the auction duration." };
    const minimum = Math.ceil(parsed.policy.minDurationSeconds / divisor), maximum = Math.floor(parsed.policy.maxDurationSeconds / divisor);
    return maximum >= minimum ? { ok: true, minimum, maximum }
      : { ok: false, reason: `The current backend policy has no whole-${unit.slice(0, -1)} duration; choose seconds.` };
  }
  function durationSeconds(raw, unit, value) {
    const parsed = auctionPolicy(value);
    if (!parsed.ok) return parsed;
    const text = String(raw ?? "");
    if (!/^[1-9][0-9]*$/.test(text)) return { ok: false, reason: "Choose a positive whole-number auction duration." };
    const amount = Number(text), multiplier = unit === "seconds" ? 1 : unit === "minutes" ? 60 : unit === "days" ? 86400 : 0;
    if (!Number.isSafeInteger(amount) || multiplier === 0 || amount > Math.floor(Number.MAX_SAFE_INTEGER / multiplier)) {
      return { ok: false, reason: "Auction duration is not a safe supported value." };
    }
    const seconds = amount * multiplier, { minDurationSeconds: minimum, maxDurationSeconds: maximum } = parsed.policy;
    if (seconds < minimum || seconds > maximum) {
      return { ok: false, reason: `Choose a duration between ${formatDuration(minimum)} and ${formatDuration(maximum)} under the current backend policy.` };
    }
    return { ok: true, seconds };
  }
  function payoutWindow(originalEndTime, value) {
    const parsed = auctionPolicy(value);
    if (!parsed.ok) return parsed;
    if (!Number.isSafeInteger(originalEndTime) || originalEndTime < 1) return { ok: false, reason: "Committed auction end time is invalid." };
    const { maxTotalExtensionSeconds, emergencyRecoverySeconds } = parsed.policy;
    if (originalEndTime > Number.MAX_SAFE_INTEGER - maxTotalExtensionSeconds
      || originalEndTime + maxTotalExtensionSeconds > Number.MAX_SAFE_INTEGER - emergencyRecoverySeconds) {
      return { ok: false, reason: "Auction payout timing exceeds the safe integer range." };
    }
    const maximumEndTime = originalEndTime + maxTotalExtensionSeconds;
    return { ok: true, maximumEndTime, validUntil: maximumEndTime + emergencyRecoverySeconds };
  }
  function scopeKey(actor, deployment) { return actor && deployment ? `${deployment}\u0000${actor}` : ""; }
  function validatorCommitObservation(validator) {
    const observation = String(validator?.observation || "");
    const height = validator?.canonical_commit_height;
    const blockHash = String(validator?.block_hash || "").toUpperCase();
    if (!observation.includes("canonical commit signature observed") || !Number.isSafeInteger(height) || height < 1
      || !/^[0-9A-F]{64}$/.test(blockHash)) return null;
    return { height, blockHash };
  }
  function validatorEvidence(validator) {
    const commit = validatorCommitObservation(validator);
    if (!commit) return {
      state: "unknown", label: "Observation unknown",
      detail: validator?.error ? "Snapshot unavailable for this validator" : "Exact commit identity was not reported",
    };
    const commitLabel = `Height ${formatSats(commit.height)} · ${commit.blockHash.slice(0, 10)}…`;
    return validator.online
      ? { state: "observed", label: "Signature observed", detail: commitLabel }
      : { state: "absent", label: "Signature not observed", detail: commitLabel };
  }
  function validatorFreshness(observedAt, nowMilliseconds = Date.now()) {
    const observedMilliseconds = Date.parse(String(observedAt || ""));
    if (!Number.isFinite(observedMilliseconds) || !Number.isFinite(nowMilliseconds)
      || observedMilliseconds > nowMilliseconds + 5_000) return "observation time unknown";
    return nowMilliseconds - observedMilliseconds > 30_000 ? "snapshot stale" : "snapshot current";
  }
  function validatorSummary(validators, observedAt, nowMilliseconds) {
    const entries = Array.isArray(validators) ? validators : [], total = 4;
    const commits = entries.map(validatorCommitObservation), exact = commits.filter(Boolean);
    const freshness = validatorFreshness(observedAt, nowMilliseconds);
    if (entries.length !== total || exact.length !== total) {
      return `Validator commit comparison unavailable · ${exact.length}/${total} exact observations · agreement unknown · ${freshness}`;
    }
    const identities = new Set(exact.map((commit) => `${commit.height}:${commit.blockHash}`));
    if (identities.size !== 1) return `Validator snapshots differ across ${identities.size} commits · agreement unknown · ${freshness}`;
    const signed = entries.filter((validator) => validator.online === true).length, commit = exact[0];
    return `${signed}/${total} signatures observed in one pinned-replica commit · height ${formatSats(commit.height)} · ${commit.blockHash.slice(0, 10)}… · ${freshness}`;
  }
  return { formatSats, formatTime, formatDuration, countdown, minimumBid, bidSuggestions, filterAuctions, fundingAmount, bidAmount, imageURL,
    auctionPolicy, auctionPaymentPolicy, durationBounds, durationSeconds, payoutWindow, scopeKey, validatorEvidence, validatorSummary };
});
