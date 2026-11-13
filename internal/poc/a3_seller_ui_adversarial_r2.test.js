const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, 'static/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'static/index.html'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '../../cashu-wrapper/ts/poc-friday-browser-entry.ts'), 'utf8');

test('A3 shipped seller UI has no legacy approval state, controls, or controller call', () => {
  for (const legacy of ['sellerAuctions', 'approvalRevision', 'approvalAbort', 'toggleSellerApprovals',
    'stopSellerApprovals', 'serviceSellerApprovals', 'seller-approval-status', 'stop-seller-approvals']) {
    assert.equal(app.includes(legacy), false, `${legacy} remains reachable in app.js`);
    assert.equal(html.includes(legacy), false, `${legacy} remains reachable in index.html`);
  }
  assert.equal(app.includes('.serviceSellerPlans('), false);
  assert.equal(html.includes('Enable bid-plan approvals for this auction'), false);
});

test('A3 creation checks the committed listing before registering the bounded offline authorization', () => {
  const retained = app.indexOf('writeListingAttempt(submitted)');
  const committedRead = app.indexOf('committed = await refreshCommittedAuction(attempt.auctionId, height)');
  const exactCheck = app.indexOf('if (!listingMatches(attempt, committed))');
  const authorization = app.indexOf('await authorizeCommittedAuctionPayout(committed)');
  const success = app.lastIndexOf('covers bids while the seller is offline');
  assert.ok(retained >= 0 && committedRead >= 0);
  assert.ok(retained < committedRead && committedRead < exactCheck && exactCheck < authorization && authorization < success);
  assert.match(app, /async function refreshCommittedAuction\(auctionId, minimumHeight, attempts = 3\)/);
  assert.match(app, /height >= minimumHeight && auction/);
  assert.match(app, /Persistent listing recovery storage is unavailable/);
  assert.match(app, /Its submission outcome is uncertain, so auction creation is blocked/);
  assert.match(app, /maximumPayout: payment\.policy\.maxPayout/);
  assert.match(app, /payment\.policy\.maxBidAmount/);
  assert.match(app, /ui\.payoutWindow\(originalEndTime, state\.config\?\.auction_policy\)/);
  assert.match(app, /validUntil: timing\.validUntil/);
});

test('A3 legacy controller recovery remains available but is not exposed as a bidding prerequisite', () => {
  assert.match(controller, /serviceSellerPlans\(/);
  assert.match(controller, /readAuctionPayout\(auctionId: string\)/);
  assert.match(controller, /registeredPayout === null && registered === null/);
  assert.match(html, /bidders do not need later seller approval/);
  assert.match(app, /no registered offline payout authorization/);
  assert.doesNotMatch(app, /Ask the seller tab|service its plans/i);
});
