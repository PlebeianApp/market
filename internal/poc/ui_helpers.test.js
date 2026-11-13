const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ui = require("./static/ui-helpers.js");

const auctionPolicy = {
  schema: "PLEBEIAN_AUCTION_TIMING_POLICY_V1",
  min_duration_seconds: 3,
  max_duration_seconds: 604800,
  default_duration_seconds: 600,
  late_bid_window_seconds: 180,
  late_bid_extension_seconds: 180,
  max_total_extension_seconds: 1800,
  emergency_recovery_seconds: 900,
};

test("funding input is explicit, integer, safe, and policy bounded", () => {
  assert.deepEqual(ui.fundingAmount("1", 100_000), { ok: true, amount: 1 });
  assert.deepEqual(ui.fundingAmount("100000", 100_000), { ok: true, amount: 100_000 });
  for (const value of ["", "0", "-1", "1.5", "1e2", " 1 ", "9007199254740992"]) {
    assert.equal(ui.fundingAmount(value, 100_000).ok, false, value);
  }
  assert.equal(ui.fundingAmount("100001", 100_000).ok, false);
});

test("bid drafts accept only safe decimal integers at the committed minimum", () => {
  assert.deepEqual(ui.bidAmount("3000", 3000, 50000), { ok: true, amount: 3000 });
  for (const value of ["", "0", "-1", "2999", "3.5", "3e3", " 3000 ", "9007199254740992"]) {
    assert.equal(ui.bidAmount(value, 3000, 50000).ok, false, value);
  }
  assert.equal(ui.bidAmount("3000", null, 50000).ok, false);
  assert.match(ui.bidAmount("50001", 3000, 50000).reason, /up to 50,000/);
});

test("auction images allow bounded credential-free HTTPS URLs only", () => {
  assert.deepEqual(ui.imageURL(""), { ok: true, url: "" });
  assert.deepEqual(ui.imageURL(" https://fastly.picsum.photos/id/1/400/300.jpg?x=1 "),
    { ok: true, url: "https://fastly.picsum.photos/id/1/400/300.jpg?x=1" });
  for (const value of [
    "http://example.com/item.jpg", "data:image/png;base64,AA==", "javascript:alert(1)",
    "//example.com/item.jpg", "https://user:password@example.com/item.jpg", "https://example.com/item.jpg#fragment",
  ]) assert.equal(ui.imageURL(value).ok, false, value);
  assert.equal(ui.imageURL(`https://example.com/${"a".repeat(500)}`).ok, false);
});

test("funding policy golden matches the Go and TypeScript canonical contract", () => {
  const canonical = '{"max_per_request":10000,"max_resulting_balance":50000,"schema":"PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1"}';
  assert.equal(crypto.createHash("sha256").update(canonical).digest("hex"),
    "3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069");
});

test("minimum bid uses the committed increment without overflow", () => {
  assert.equal(ui.minimumBid({ starting_bid: 100, high_bid: 0, min_increment: 20 }), 100);
  assert.equal(ui.minimumBid({ starting_bid: 100, high_bid: 120, min_increment: 20 }), 140);
  assert.equal(ui.minimumBid({ starting_bid: 100, high_bid: Number.MAX_SAFE_INTEGER, min_increment: 1 }), null);
});

test("Arena-style bid shortcuts stay exact, deterministic, and overflow-safe", () => {
  assert.deepEqual(ui.bidSuggestions({ starting_bid: 100, high_bid: 120, min_increment: 20 }, 50000), [
    { label: "Next", amount: 140 }, { label: "Jump", amount: 180 }, { label: "Big move", amount: 320 },
  ]);
  assert.deepEqual(ui.bidSuggestions({ starting_bid: 100, high_bid: Number.MAX_SAFE_INTEGER, min_increment: 1 }, 50000), []);
  assert.deepEqual(ui.bidSuggestions({ starting_bid: 49990, high_bid: 49990, min_increment: 10 }, 50000), [
    { label: "Next", amount: 50000 },
  ]);
});

test("auction payment limits are exact reviewed runtime data", () => {
  const policy = { schema: "PLEBEIAN_FRIDAY_AUCTION_PAYMENT_POLICY_V1", max_bid_amount: 50000, max_payout: 50000 };
  assert.deepEqual(ui.auctionPaymentPolicy(policy), { ok: true, policy: { maxBidAmount: 50000, maxPayout: 50000 } });
  assert.equal(ui.auctionPaymentPolicy({ ...policy, max_bid_amount: 50001 }).ok, false);
  assert.equal(ui.auctionPaymentPolicy({ ...policy, extra: true }).ok, false);
});

test("countdown reports awaiting committed close and never claims local closure", () => {
  assert.deepEqual(ui.countdown(1_120, 1_000), { ended: false, label: "2m 00s remaining" });
  assert.deepEqual(ui.countdown(999, 1_000), { ended: true, label: "Ended · awaiting committed close" });
  assert.deepEqual(ui.countdown(999, 1_000, true), { ended: true, label: "Closed · committed" });
});

test("seller duration uses the backend-advertised policy and whole selected unit", () => {
  assert.equal(ui.auctionPolicy(auctionPolicy).ok, true);
  assert.deepEqual(ui.durationBounds("minutes", auctionPolicy), { ok: true, minimum: 1, maximum: 10080 });
  assert.deepEqual(ui.durationBounds("days", auctionPolicy), { ok: true, minimum: 1, maximum: 7 });
  assert.deepEqual(ui.durationSeconds("10", "minutes", auctionPolicy), { ok: true, seconds: 600 });
  assert.deepEqual(ui.durationSeconds("3", "seconds", auctionPolicy), { ok: true, seconds: 3 });
  assert.deepEqual(ui.durationSeconds("7", "days", auctionPolicy), { ok: true, seconds: 604800 });
  assert.match(ui.durationSeconds("8", "days", auctionPolicy).reason, /between 3 seconds and 7 days/);
  assert.equal(ui.durationSeconds("1.5", "minutes", auctionPolicy).ok, false);
  assert.equal(ui.auctionPolicy({ ...auctionPolicy, max_duration_seconds: 2 }).ok, false);
  assert.match(ui.auctionPolicy({ ...auctionPolicy, max_duration_seconds: 691200 }).reason, /not a reviewed/);
  assert.match(ui.auctionPolicy({ ...auctionPolicy, max_total_extension_seconds: 180 }).reason, /not a reviewed/);
  assert.match(ui.auctionPolicy({ ...auctionPolicy, emergency_recovery_seconds: 1 }).reason, /not a reviewed/);
  assert.match(ui.auctionPolicy({ ...auctionPolicy, unreviewed_override: 1 }).reason, /unexpected fields/);
  assert.equal(ui.auctionPolicy({ ...auctionPolicy, max_duration_seconds: 3600 }).ok, true);
});

test("payout and bid lock windows follow the advertised anti-sniping cap", () => {
  assert.deepEqual(ui.payoutWindow(1_900_000_000, auctionPolicy), {
    ok: true, maximumEndTime: 1_900_001_800, validUntil: 1_900_002_700,
  });
});

test("actor and deployment form one exact stale-result scope", () => {
  assert.equal(ui.scopeKey("actor", "deployment"), "deployment\u0000actor");
  assert.equal(ui.scopeKey("", "deployment"), "");
});

test("validator summaries require an explicit shared height and block hash", () => {
  const blockHash = "AB".repeat(32), otherBlockHash = "CD".repeat(32);
  assert.equal(ui.validatorEvidence({ online: true }).state, "unknown");
  assert.equal(ui.validatorEvidence({ online: true, canonical_commit_height: 9,
    block_hash: blockHash, observation: "canonical commit signature observed via pinned local full replica" }).state, "observed");
  assert.equal(ui.validatorSummary([
    { online: true, canonical_commit_height: 9, block_hash: blockHash, observation: "canonical commit signature observed" },
    { online: true, canonical_commit_height: 9, block_hash: blockHash, observation: "canonical commit signature observed" },
    { online: true, canonical_commit_height: 10, block_hash: otherBlockHash, observation: "canonical commit signature observed" },
    { online: false, canonical_commit_height: 9, block_hash: blockHash, observation: "canonical commit signature observed" },
  ], "2026-11-12T00:00:00Z", Date.parse("2026-11-12T00:00:01Z")), "Validator snapshots differ across 2 commits · agreement unknown · snapshot current");
  assert.equal(ui.validatorSummary([
    { online: true, canonical_commit_height: 9, block_hash: blockHash, observation: "canonical commit signature observed" },
    { online: true, canonical_commit_height: 9, block_hash: blockHash, observation: "canonical commit signature observed" },
    { online: true, canonical_commit_height: 9, block_hash: blockHash, observation: "canonical commit signature observed" },
    { online: false, canonical_commit_height: 9, block_hash: blockHash, observation: "canonical commit signature observed" },
  ], "2026-11-12T00:00:00Z", Date.parse("2026-11-12T00:01:00Z")), "3/4 signatures observed in one pinned-replica commit · height 9 · ABABABABAB… · snapshot stale");
  assert.match(ui.validatorSummary([{ online: true, canonical_commit_height: 12 }]), /agreement unknown/);
});

test("deployable UI is R20-only and contains no preset business values", () => {
  const html = fs.readFileSync(path.join(__dirname, "static/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "static/app.js"), "utf8");
  for (const id of ["faucet-amount", "title", "duration", "starting", "increment", "reserve"]) {
    const input = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] || "";
    assert.ok(input, `missing input ${id}`); assert.doesNotMatch(input, /\bvalue=/);
  }
  assert.match(html, /3-of-4 FROST monetary authorization/);
  assert.match(app, /window\.plebeianFridayR20Connect/);
  assert.match(app, /runExclusiveMaintenance\(captured,async\(held\)=>/);
  assert.match(app, /held\.fundFake\(parsed\.amount\)/);
  assert.match(app, /importAvailable\(\)/);
  assert.match(app, /seller payout/);
  assert.doesNotMatch(app, /\/api\/cashu\//);
  assert.doesNotMatch(app, /\/api\/admin\/offline/);
  assert.doesNotMatch(app, /fundFake\(10000\)/);
  assert.doesNotMatch(app, /POST[^\n]*\/api\/close/);
  const nginx = fs.readFileSync(path.join(__dirname, "../../deploy/sidequest-mvp/nginx-public-demo-active-r2.conf"), "utf8");
  assert.match(nginx, /img-src 'self' data: https:/);
  assert.doesNotMatch(nginx, /img-src[^;]*\*/);
  const root = nginx.match(/location \/ \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(root, /connect-src 'self' wss:\/\/relay\.powr\.build;/);
  assert.doesNotMatch(root, /connect-src[^;]*\swss:\s*(?:;|$)/);
});
