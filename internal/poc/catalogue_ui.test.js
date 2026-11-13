const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const staticDir = path.join(__dirname, "static");
const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
const app = fs.readFileSync(path.join(staticDir, "app.js"), "utf8");
const css = fs.readFileSync(path.join(staticDir, "styles.css"), "utf8");

test("catalogue shell is wired to the existing committed-state application", () => {
  assert.match(html, /Plebeian Auctions — Catalogue MVP/);
  assert.match(html, /id="market" class="catalogue-shell"/);
  assert.match(html, /id="auctions"/);
  assert.match(app, /committedState\(suffix\)/);
  assert.match(app, /api\(`\/api\/state\$\{suffix\}`, \{ signal: abort\.signal \}\)/);
  assert.match(app, /api\("\/api\/validators"\)/);
  assert.match(app, /const presentationView = state\.view;/);
  assert.match(app, /state\.auctionPresentationView = presentationView;/);
  assert.match(app, /const committedBids = Object\.values\(presentationView\?\.state\?\.bids/);
  assert.match(app, /ui\.validatorSummary\(validators,state\.validators\?\.observed_at\)/);
  assert.doesNotMatch(app, /window\.Auction|setBotLevel|setRig|proxyAmount/);
});

test("mockup-only capabilities are visibly gated instead of simulated", () => {
  assert.match(html, /Core transaction path only\./);
  for (const capability of ["Livestream", "chat", "max-bid automation", "seller reputation", "watchlists", "private shipping rooms"]) {
    assert.match(html, new RegExp(capability));
  }
  assert.doesNotMatch(html, /<video|live-pitch|watch-[1-4]\.jpg|lot-camera|lot-keyboard/i);
});

test("catalogue preserves uncertain payment states and committed close language", () => {
  assert.doesNotMatch(app, /wallet\.pending \+ wallet\.unresolved/);
  assert.match(app, /locked, pending, and unresolved proof totals are not projected by this R70 wallet API/);
  assert.match(app, /You were outbid/);
  assert.match(app, /unknown outcome\. Any changed draft recovers this operation/);
  assert.match(app, /Seller payout settled/);
  assert.match(app, /not shown as imported until that import finishes/);
  assert.match(app, /seller_plan_pending/);
  assert.match(app, /Awaiting the R20 deterministic close trigger and committed closed state/);
  assert.match(html, /Returns \/ settlement/);
  assert.doesNotMatch(html, /refunded instantly|held in escrow until delivery/i);
});

test("public copy keeps demo boundaries without federal certification references", () => {
  const runbook = fs.readFileSync(path.join(__dirname, '../../SIDEQUEST-MVP-RUNBOOK.md'), 'utf8');
  const integrationGuide = fs.readFileSync(path.join(__dirname, '../../docs/contributors/CATALOGUE-UI-INTEGRATION.md'), 'utf8');
  assert.match(html, /jmcorgan\/fips transport/);
  assert.match(html, /One operator · fake sats only · not production/);
  assert.match(html, /This is not a production payment system/);
  assert.match(integrationGuide, /fake sats, one operator/);
  assert.match(integrationGuide, /jmcorgan\/fips transport/);
  assert.match(runbook, /independent-operator safety/);
  for (const currentCopy of [html, runbook, integrationGuide]) {
    assert.doesNotMatch(currentCopy, /FIPS[ -]?140|federal[ -]?FIPS/i);
    assert.match(currentCopy, /fake[- ]sats?|fake money/i);
    assert.match(currentCopy, /not production|does not establish[\s\S]{0,80}production/i);
  }
});

test("seller chooses backend-bounded duration with short demo and seven-day shortcuts", () => {
  assert.match(html, /id="duration-unit"/);
  for (const shortcut of ["duration-10m", "duration-30m", "duration-1d", "duration-7d"]) assert.match(html, new RegExp(`id="${shortcut}"`));
  assert.match(app, /ui\.durationSeconds\(/);
  assert.match(app, /ui\.payoutWindow\(/);
  assert.match(app, /committed\.original_end_time - committed\.created_at === listing\.duration_seconds/);
  assert.doesNotMatch(app, /duration>3600|Duration may not exceed 3,600/);
});

test("catalogue uses local presentation assets and responsive accessible styling", () => {
  assert.match(css, /--accent:\s*#c8157f/);
  assert.match(css, /\.auction-placeholder/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.bid-suggestions/);
  assert.match(css, /\.countdown-metric/);
  assert.match(html, /href="#validator-network">Validators/);
  assert.doesNotMatch(html, />Evidence</);
  assert.match(css, /@media \(max-width: 340px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /input, textarea, select \{ min-height: 2\.85rem; font-size: 16px; \}/);
  assert.match(css, /\.capability-gate summary \{[^}]*min-height: 2\.75rem/);
  assert.doesNotMatch(css, /url\(|@font-face/);
});

test("catalogue identifies and implements Chiefmonkey Design A without mock-only media", () => {
  assert.match(html, /data-design-reference="chief-a-catalogue"/);
  assert.match(html, /class="catalogue-tabs"/);
  assert.match(html, /class="breadcrumbs"/);
  assert.match(css, /\.auction\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1\.24fr\) minmax\(22rem, \.92fr\)/s);
  assert.match(css, /\.price-row\s*\{[^}]*border-radius:\s*1rem;[^}]*background:\s*var\(--surface-strong\)/s);
  assert.match(css, /\.site-header nav a\[href="#market"\]/);
  assert.match(html, /href="#market" aria-current="page"/);
  assert.doesNotMatch(html, /<nav class="breadcrumbs"/);
  assert.doesNotMatch(html, /<video|live-pitch|watch-[1-4]\.jpg/i);
});

test("signed-in dashboard prioritizes account and wallet truth without fabricating a badge", () => {
  const profileSource = fs.readFileSync(path.join(__dirname, '../../cashu-wrapper/ts/poc-nostr-profile.ts'), 'utf8');
  assert.match(html, /id="account-dashboard"/);
  assert.match(html, /id="profile-avatar"[^>]*referrerpolicy="no-referrer"/);
  assert.match(html, /id="profile-name"/);
  assert.match(html, /A zero mobile balance does not mean desktop funds were lost/);
  assert.match(html, /Wallet on this device/);
  assert.match(html, /Signing in elsewhere does not sync these funds or pending returns/);
  assert.match(html, /Plebeian badge · verification unavailable/);
  assert.match(html, /no configured trusted issuer or award definition/);
  assert.doesNotMatch(html, /data-state="verified"|Plebeian badge · verified/);
  assert.match(css, /body\[data-identity="connected"\] \.catalogue-intro h1/);
  assert.match(css, /\.account-dashboard/);
  assert.match(app, /window\.plebeianReadNostrProfile\(actor, \{ signal: abort\.signal \}\)/);
  assert.match(app, /actor !== state\.actor \|\| generation !== state\.generation/);
  assert.match(app, /Increasing your own leading bid is not supported yet/);
  assert.match(profileSource, /PROFILE_RELAY = 'wss:\/\/relay\.powr\.build\/'/);
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'console.log', 'console.warn', 'location.search']) {
    assert.equal(profileSource.includes(forbidden), false, `profile reader must not use ${forbidden}`);
  }
  assert.equal((profileSource.match(/wss:\/\//g) || []).length, 1, 'profile lookup must not add another relay origin');
});

test("validator copy does not turn one replica snapshot into four independent node claims", () => {
  assert.match(html, /one pinned replica's view/);
  assert.match(app, /Technical details/);
  assert.match(app, /validator\.moniker \|\| `Validator/);
  assert.doesNotMatch(html, /Bitcoin nodes|node runners/i);
  assert.doesNotMatch(app, /Math\.max\(\.\.\.heights\)/);
});
