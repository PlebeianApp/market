const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ui = require("./static/ui-helpers.js");

test("funding input is explicit, integer, safe, and policy bounded", () => {
  assert.deepEqual(ui.fundingAmount("1", 100_000), { ok: true, amount: 1 });
  assert.deepEqual(ui.fundingAmount("100000", 100_000), { ok: true, amount: 100_000 });
  for (const value of ["", "0", "-1", "1.5", "1e2", " 1 ", "9007199254740992"]) {
    assert.equal(ui.fundingAmount(value, 100_000).ok, false, value);
  }
  assert.equal(ui.fundingAmount("100001", 100_000).ok, false);
});

test("bid drafts accept only safe decimal integers at the committed minimum", () => {
  assert.deepEqual(ui.bidAmount("3000", 3000), { ok: true, amount: 3000 });
  for (const value of ["", "0", "-1", "2999", "3.5", "3e3", " 3000 ", "9007199254740992"]) {
    assert.equal(ui.bidAmount(value, 3000).ok, false, value);
  }
  assert.equal(ui.bidAmount("3000", null).ok, false);
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

test("countdown reports awaiting committed close and never claims local closure", () => {
  assert.deepEqual(ui.countdown(1_120, 1_000), { ended: false, label: "2m 00s remaining" });
  assert.deepEqual(ui.countdown(999, 1_000), { ended: true, label: "Ended · awaiting committed close" });
});

test("actor and deployment form one exact stale-result scope", () => {
  assert.equal(ui.scopeKey("actor", "deployment"), "deployment\u0000actor");
  assert.equal(ui.scopeKey("", "deployment"), "");
});

test("validator RPC reachability is never presented as a signature", () => {
  assert.equal(ui.validatorEvidence({ online: true }).state, "unknown");
  assert.equal(ui.validatorEvidence({ online: true, canonical_commit_height: 9,
    observation: "canonical commit signature observed via validator 1 loopback RPC" }).state, "observed");
});

test("deployable UI is R20-only and contains no preset business values", () => {
  const html = fs.readFileSync(path.join(__dirname, "static/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "static/app.js"), "utf8");
  for (const id of ["faucet-amount", "title", "duration", "starting", "increment", "reserve"]) {
    const input = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] || "";
    assert.ok(input, `missing input ${id}`); assert.doesNotMatch(input, /\bvalue=/);
  }
  assert.match(html, /3-of-4 FROST admission/);
  assert.match(app, /window\.plebeianFridayR20Connect/);
  assert.match(app, /state\.friday\.fundFake\(parsed\.amount\)/);
  assert.match(app, /importAvailable\(\)/);
  assert.match(app, /seller payout/);
  assert.doesNotMatch(app, /\/api\/cashu\//);
  assert.doesNotMatch(app, /\/api\/admin\/offline/);
  assert.doesNotMatch(app, /fundFake\(10000\)/);
  assert.doesNotMatch(app, /POST[^\n]*\/api\/close/);
  const nginx = fs.readFileSync(path.join(__dirname, "../../deploy/sidequest-mvp/nginx-public-demo-active-r2.conf"), "utf8");
  assert.match(nginx, /img-src 'self' data: https:/);
  assert.doesNotMatch(nginx, /img-src[^;]*\*/);
});
