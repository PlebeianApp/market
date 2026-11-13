# Seller patch R38/R17 upgrade plan

Status: **locally prepared and tested; not approved for activation**. This plan does not authorize a deployment, service stop, live database or anchor creation, environment edit, credential operation, or fake-sat transaction.

This plan supersedes the site identity and UI behavior in `SELLER-PATCH-UPGRADE-PLAN-R2.md`. The R2 backend R38 binaries, 10-second authenticated-head-age policy, 2-second future-skew policy, seven-operation compatibility rules, backup requirements, recovery constraints, acceptance workflow, and activation blockers remain unchanged. Site R16 must not be installed because it still embeds the legacy seller bid-plan approval controls.

## Behavior corrected in R17

- The auction card no longer renders `Enable bid-plan approvals for this auction` or `Stop bid-plan approvals`.
- The browser no longer holds seller-approval selection, revision, or abort state and never calls `serviceSellerPlans` from the public UI.
- Auction creation commits the signed listing, refreshes and verifies the exact committed seller and bidding terms, then registers one bounded auction-scoped payout authorization.
- If that post-commit authorization is interrupted, the seller sees one `Complete offline bidding setup` recovery action for the exact committed auction. It retries the immutable auction authorization; it does not approve an individual bid.
- A registered auction payout lets independent bidders use the funded-bid path while the seller tab is offline. No per-bid seller signature or seller tab is required.
- `Import available returns & payouts` performs passive certified imports only.
- A legacy auction without a registered offline payout authorization remains fail-closed before payment lock. The UI reports that state without directing the user to a seller approval loop.
- The underlying legacy controller API remains available solely for exact recovery/compatibility of older durable records; it is not exposed as a new-auction bidding prerequisite.

## Candidate identities

- Backend release: `sidequest-mvp-r4-seller-patch-r38` (unchanged from R2).
- Site release: `sidequest-mvp-r4-site-r17`.
- Site guard: `verify-sidequest-site-r17.py`.
- Site unit: `plebeian-friday-site-r17.service`.
- The site guard chains directly to the exact deployed R14 guard because R15 and R16 were never deployed.

## Reproducible isolated site build

The reviewed R38 staged TypeScript sources and rebuilt browser bundle were retained. Only the reviewed R17 UI and UI tests were copied into the isolated stage before building:

```text
stage: /tmp/plebeian-seller-r38-stage.AsxOMf/source
command:
  GOCACHE=<stage>/metadata/go-build-cache-r17 \
    go build -trimpath -buildvcs=false -mod=readonly \
    -o <stage>/artifacts/site-r17-N/bin/plebeian-auctions-mvp .
```

Two independent invocations produced byte-for-byte identical files.

- `plebeian-auctions-mvp`: 46,625,128 bytes; SHA-256 `ae6f901b9f3fdc20686c6cd954522561f9b0252916cfbd9587606ee432488dec`.
- Embedded `friday-browser.js` remains the reviewed R38 bundle: 1,753,282 bytes; SHA-256 `3084b94c6a710d4342aec7b3b8c3ac01615326e3bc7d34d55063127c8a0aaf18`.
- The tracked `internal/poc/static/friday-browser.js` was regenerated from the reviewed TypeScript with Bun 1.3.11 and now matches that embedded bundle byte-for-byte.
- Binary inspection found the new bounded-authorization/import text and no legacy enable/stop approval label.
- A third site build from the current working tree reproduced the isolated candidate byte-for-byte.

## Verification completed

- UI behavior: six focused tests passed, including exact create authorization, independent bidder admission without seller-plan service, import-only maintenance, legacy pre-lock refusal, and an exact setup retry after authorization failure.
- Complete local UI suite: five test files passed.
- Focused controller/V3/recovery suite: 12 tests, 222 assertions, zero failures.
- Browser-controller suite: 124 tests, 457 assertions, zero failures.
- Friday TypeScript typecheck passed.
- `go test ./...` passed with a temporary writable Go cache.
- R17 guard compiled, accepted the exact candidate, and rejected a wrong-mode fixture.
- Unit verification parsed the unit and reported only the expected absent not-yet-installed `/opt` binary.

## Approval-gated remaining work

R2's complete activation sequence remains mandatory, substituting R17 for R16. Before activation:

1. Obtain separate approval for service stop, backup, install, environment/store/unit changes, and service start.
2. Recheck the source/artifact pins, full seven-operation inventory, live service paths, APP NTP health, and at least five authenticated H+1 samples inside 10/2.
3. Verify authenticated public WebSocket behavior through nginx.
4. Take and verify the non-overwriting, metadata-preserving full backup required by R2.
5. Install R38/R17 into new release directories, run both guards, initialize absent stores exactly once, and change units only in the approved order.
6. Run the five-profile fake-sat end-to-end acceptance: funding, seller offline, bid, outbid returns, close, payout, failure/recovery, exact balances, and conservation.

Until all of those pass, R38/R17 is an isolated candidate, not a deployed or live-verified release.
