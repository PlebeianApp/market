# Seller patch R37 upgrade plan

Status: **prepared, not approved for activation**. This document does not authorize a deployment, service stop, database initialization, reset, deletion, live bid or credential operation.

## Release decision

Preserve the seven existing `recipient_pending` operations in place. They are fake-sat records, but deleting only their coordinator or terminal rows would discard idempotency evidence while leaving independent rollback anchors and related mint-effect records intact. The compatibility test proves the successor can restart with all seven, leave them unchanged without acknowledgements, and complete them only after genuine recipient-key acknowledgements without another execute or recovery mint effect.

The minimally scoped choice is therefore:

1. Do not delete, reset, acknowledge or relabel the seven operations.
2. Treat their balances as abandoned for acceptance accounting.
3. Use five fresh browser profiles and record their zero baselines.
4. Preserve the full runtime and independent anchor as the rollback/recovery record.

If logical disposal is still desired later, archive this complete deployment generation and create a separately reviewed fresh generation. Do not surgically delete the seven rows.

## Verified preflight

- APP clock: NTP synchronized.
- Observer: active, not catching up, chain `plebeian-auctions-mvp-20261102`.
- Five authenticated H+1 samples: 0.152, 0.187, 0.251, 0.306 and 0.480 seconds old; each had three commit signatures and validators hash `D1936C5E5E9D09D0A96107031AE144068DCC2AD3F1D071E7F8FE871A8AAFF773`.
- Proposed and guard-pinned freshness policy: maximum authenticated head age 30 seconds; maximum future skew 5 seconds.
- Per-RPC read bound: 5 seconds. Complete authenticated payout read bound: 15 seconds.
- Active predecessor: site R14; authority/coordinator/terminal R36. All four APP services inspected were active; the three changed services reported zero restarts.
- `auction-payout.sqlite3` is absent from both the runtime and separated anchor, as required before create-once initialization.
- The active environment has neither freshness key, so the new authority would fail closed until the two exact values are added.
- Current full tree: Friday tests 382 pass / 0 fail / 1,604 expectations; Friday typecheck passes; `go test ./...` passes; both UI test files pass.

The proposed 30/5 values are deliberately much wider than the measured healthy range but still fail closed on a stopped or historical observer. They remain an owner policy choice until activation is approved.

## Seven preserved legacy operations

Four winner payouts and three returns have terminal notices and no acknowledgements:

- `e82c3d5943e89c26087c5f12466273f7d0c5ba4907ef63771b46fbab36a58734` — winner payout.
- `7572f156484ff2805e8935e5abef61d51f990a6cdb1e6bf53af100e68bba19ba` — winner payout; coordinator request digest absent.
- `7a2ada64ee9134a10df6975800f598eee164b07ae9c67aa641cc1d382dccbf9f` — outbid return.
- `63da655f8958810434ece0e0159436424d2b5aacfb3764a0d681f76f4429ffc1` — rejected return.
- `ec958664c1fb2ffef5a4ee1aa07e48d9f49af1cfc719a488e7aa410201d1f1bf` — winner payout.
- `84069b68d726d7853a2566ef0d2d54e24d4ce7d2f1a295e17d36c5336e26c3d6` — winner payout.
- `521b34e25d017adfd7453e6fc402f433001cfd0a28c16fe925c4bb59c3862e68` — outbid return; coordinator request digest absent.

The exact IDs, terminal-response digests and two missing request-digest states must survive the upgrade.

## Prepared artifacts

- Backend release name: `sidequest-mvp-r4-seller-patch-r37`.
- Site release name: `sidequest-mvp-r4-site-r15`.
- Hash-pinned guards: `verify-sidequest-seller-patch-r37.py` and `verify-sidequest-site-r15.py`.
- Unit templates: `plebeian-friday-authority-r37.service`, `plebeian-friday-coordinator-r37.service` and `plebeian-friday-site-r15.service`.
- Build and preflight receipt: `seller-patch-upgrade-preflight-20261105.json`.

R37 chains to the exact R36 verifier. R15 chains to the exact deployed R14 verifier. Validators and signers are not in the activation scope; the current-tree signer build is evidence only.

## Approval-gated activation sequence

Every step below requires a separately approved maintenance action and a create-once actual-or-stopped receipt. Stop on the first discrepancy without retry, reset or deletion.

1. Recheck the source checkpoint, artifact sizes/hashes, active service paths, zero-restart state, NTP synchronization, observer chain/roster/freshness, absence of both payout stores and the seven-operation inventory.
2. Verify the authenticated public WebSocket path through nginx with a fresh read-only browser identity. Do not place a bid during this check.
3. Fence new work by stopping the site, then authority, then coordinator. Keep observer, mint, validators and signers running. Confirm the three public/backend listeners are absent and no operation is executing.
4. Create one timestamped, non-overwriting backup that preserves ownership, modes, links and timestamps for:
   - all files, WALs and SHMs under `/var/lib/plebeian-auctions-friday/coordinator-v3/runtime`;
   - all files, WALs and SHMs under `/var/lib/plebeian-auctions-friday-anchor-separated`;
   - `/etc/plebeian-auctions-friday`, the three active units, active nginx configuration and the R14/R36 release/verifier files;
   - service status, database inventory and a SHA-256 manifest.
5. Verify the backup manifest and open copied SQLite databases read-only with integrity checks. Do not delete the source or compact any journal.
6. Install the R37 and R15 files into new release directories. Do not overwrite R14 or R36. Run both successor guards before changing units.
7. Add exactly these environment entries, preserving every other line:
   - `PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS=30`
   - `PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS=5`
8. As user `plebeian-friday`, run the R37 authority once in `init-auction-payout` mode. It must exclusively create only:
   - `/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/auction-payout.sqlite3`
   - `/var/lib/plebeian-auctions-friday-anchor-separated/auction-payout.sqlite3`
   Both must have deployment ID `friday-demo-20261030-separated-v1` and revision zero. Any pre-existing target is a stop condition.
9. Preserve the predecessor units, install the three successor units, daemon-reload, and rerun the guards. Confirm the authority unit sees both payout-store conditions.
10. Start coordinator, then authority, then site. Do not start a service whose predecessor/guard/readiness check fails.
11. Verify loopback and authenticated HTTPS readiness, exact artifact hashes, service PIDs, zero restarts, observer freshness and the unchanged seven-operation inventory. Reconciliation without recipient acknowledgements must not change their phase, identifiers or mint-effect evidence.
12. Only after the read-only checks pass, run the fresh-profile acceptance below.

## Exact fake-sat acceptance

Use isolated profiles: seller, bidder A, bidder B, read-only observer and fault controller. Record actor IDs, payout keys, operation IDs, state heights, app hashes and balance objects at each checkpoint. The seven legacy operations are excluded from this baseline.

1. Start with seller 0, bidder A 0 and bidder B 0 available/locked/pending/unresolved; observer and fault profiles hold no wallet.
2. Fund bidder A with exactly 5,000 fake sats and bidder B with exactly 5,000. Expected: A 5,000 available; B 5,000 available; seller 0.
3. Seller creates one auction with starting bid 1,000, minimum increment 500, reserve 0, payout cap 5,000 and a duration long enough for controlled restart checks. Seller signs and registers the auction-scoped payout catalog once.
4. Close the seller tab completely. From this point through automatic close, no seller signature, seller-plan approval or seller browser request is permitted.
5. Bidder A bids exactly 1,000. Expected A: 4,000 available, 1,000 locked, total 5,000. B remains 5,000 available. Record the exact bid and funding operation IDs.
6. Perform one approved authority/coordinator restart while the seller remains offline. After readiness, verify A's same operation and 1,000 lock remain; no new terminal notice or mint effect exists.
7. Bidder B bids exactly 1,500 and replaces A's exact bid. Expected B: 3,500 available, 1,500 locked, total 5,000. A remains 4,000 available plus a 1,000 return entitlement until import.
8. Bidder A imports the outbid return once. Expected A: 5,000 available, 0 locked/pending/unresolved. Repeat the import read once; it must import zero and leave the balance unchanged.
9. With separate fault approval, make one validator unavailable and prove the already-pinned three-validator quorum continues with three signatures; restore and verify rejoin. Do not change signer keys, enrollment or DKG state.
10. Allow the auction to close automatically. Expected winner: B at 1,500. B becomes 3,500 available and 0 locked/pending/unresolved. Seller remains offline with 0 available and exactly one 1,500 winner terminal delivery pending.
11. Restart coordinator and authority once in that recipient-pending state. Verify the same winner operation ID, terminal-response digest and one terminal notice persist, with no additional mint effect.
12. Reopen the original seller profile and import the winner payout once. Expected seller: 1,500 available and 0 locked/pending/unresolved. Repeat the import read once; it must import zero.
13. Final fresh-profile conservation: A 5,000 + B 3,500 + seller 1,500 = 10,000 fake sats, with every fresh-profile unavailable bucket zero. Expected new terminal results: one acknowledged outbid return and one acknowledged winner payout.

For every failure, preserve the exact operation ID and evidence. Never retry under a new operation ID. A balance discrepancy, second mint effect, stale/future state acceptance, missing acknowledgement, websocket failure, service restart, pin drift or nonzero unavailable final balance fails acceptance.

## Evidence bundle

The acceptance receipt must contain:

- source commit/diff digest and all installed file hashes/sizes;
- predecessor and successor units, verifier output and service status/PIDs/restart counts;
- NTP status and at least five authenticated state/H+1 samples;
- before/after metadata plus read-only rows for the seven legacy operations;
- fresh actor IDs, auction ID, bid/funding/terminal operation IDs and chain heights/app hashes;
- all wallet balance objects at every numbered checkpoint;
- terminal notice/ack digests and mint-effect identity for the new refund and payout;
- validator outage/rejoin evidence and authenticated public WebSocket evidence;
- database/anchor revision snapshots and final read-only integrity checks.

## Rollback and recovery

- Before any new R37 operation: stop site, authority and coordinator; restore only the R14/R36 unit references and prior environment file; start coordinator, authority and site. Preserve the new payout databases and all receipts rather than deleting them.
- After any R37 operation or uncertain mint effect: do not restore database snapshots or run R14/R36 blindly. Stop public admission, preserve every current database/anchor/journal and enter a separately reviewed recovery-only decision.
- A raw database snapshot may be restored only as a complete matched runtime-plus-anchor set and only when it is proven that no post-snapshot effect occurred. Otherwise rollback would violate monotonic anchors or duplicate an effect.

## Remaining approvals and blockers

- Owner approval of the exact 30-second age and 5-second future-skew policy.
- Owner approval of the service-stop/backup/store-initialization/install/start action.
- Authenticated public WebSocket verification through the deployed nginx path.
- A stable source checkpoint coordinated with the separate GitHub reviewer; no concurrent commit or push.
- The full fake-sat acceptance above. Until it passes, this is a locally prepared release, not a verified deployment.
