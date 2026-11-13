# Seller patch R38/R16 upgrade plan

Status: **locally prepared and tested; not approved for activation**. This plan does not authorize a deployment, service stop, live database or anchor creation, environment edit, credential operation, or fake-sat transaction.

This plan supersedes only the release identifiers, artifact pins, and freshness decision in `SELLER-PATCH-UPGRADE-PLAN-R1.md`. The R1 seven-operation inventory, complete-backup rule, acceptance workflow, recovery constraints, and prohibition on surgical deletion remain mandatory.

## Approved demo freshness policy

- Maximum authenticated H+1 head age: **10 seconds**.
- Maximum future skew: **2 seconds**.
- Per-Comet-RPC timeout: 5 seconds.
- Complete authenticated payout-read timeout: 15 seconds.
- Missing, partial, 30/5, malformed, stale, future-dated, regressed-clock, wrong-chain, or timed-out evidence fails closed for new seller authorizations and selections.
- Recovery of already durable operations remains available under its existing exact-identity rules.

The 10/2 values are a demo-only policy based on prior read-only observations of roughly 1.3–1.5-second healthy authenticated-head age, low NTP offsets, and one-second PBTS precision. They are not a production SLA. Activation must obtain fresh APP NTP and authenticated H+1 measurements; this preparation did not contact or modify the live server.

## Successor identities

- Backend release: `sidequest-mvp-r4-seller-patch-r38`.
- Site release: `sidequest-mvp-r4-site-r16`.
- Backend guard: `verify-sidequest-seller-patch-r38.py`.
- Site guard: `verify-sidequest-site-r16.py`.
- Units: `plebeian-friday-authority-r38.service`, `plebeian-friday-coordinator-r38.service`, and `plebeian-friday-site-r16.service`.
- The backend guard chains directly to the exact deployed R36 guard because R37 was never deployed.
- The site guard chains directly to the exact deployed R14 guard because R15 was never deployed.

R38/R16 include the bounded mint/trust-read transports, bounded Comet RPC reads, seller-offline V3 catalog and winner fence, payment-key V3 package authorization, participant-local seller actor/payment-key admission binding, legacy recipient-pending compatibility, and pre-envelope abort-capsule recovery.

## Reproducible isolated build

The build uses a copied working-tree snapshot, never the live release directories:

```text
cashu-wrapper/ts:
  bun build poc-friday-browser-entry.ts --target=browser --minify --outfile=../../internal/poc/static/friday-browser.js
  bun build ./demo-friday-authority-cli.ts --compile --target=bun-linux-x64-baseline --outfile <stage>/artifacts/backend/bin/plebeian-friday-authority
  bun build ./demo-friday-coordinator-cli.ts --compile --target=bun-linux-x64-baseline --outfile <stage>/artifacts/backend/bin/plebeian-friday-coordinator
  bun build ./demo-friday-terminal-executor-cli.ts --compile --target=bun-linux-x64-baseline --outfile <stage>/artifacts/backend/bin/plebeian-friday-terminal-executor

repository root:
  GOCACHE=<stage>/metadata/go-build-cache go build -trimpath -buildvcs=false -mod=readonly -o <stage>/artifacts/site/bin/plebeian-auctions-mvp .
```

Tool and dependency pins:

- Bun 1.3.11, executable SHA-256 `6d5bb405b1d037a2a466b92757de7e47e4369930fa94bd42f8ff44ba49de6c57`.
- Go 1.23.1, executable SHA-256 `38379bebce720e1abb72fa3232d3c7b07a4e71dd1e98fa5fcc6f9a56dd084a06`.
- Repository and trusted-cache `bun.lock` SHA-256 `2610381f8ad8771443752675059807266f4c716644a1f13550d4c92a9eb0e29b`.
- Trusted dependency cache: `/tmp/plebeian-trust-reads.IWg3d2/cashu-wrapper/ts/node_modules`.

All four executables and the browser bundle reproduced byte-for-byte in a second build.

## Pinned artifacts

- `plebeian-friday-authority`: 99,653,664 bytes; SHA-256 `07733396fef23b1c5284a354ef35bfe73174994a1bd0f91a1993d17ab5a6024f`.
- `plebeian-friday-coordinator`: 98,657,868 bytes; SHA-256 `eebaaf66dfba7d86a429a91b9f7e555c815e13f47709859f59b9888688a4cf91`.
- `plebeian-friday-terminal-executor`: 99,116,862 bytes; SHA-256 `cf5f3d016ef68b26ac45b8a16539a4169d628629e405414dad9fa6fc673d92d0`.
- `plebeian-auctions-mvp`: 46,633,312 bytes; SHA-256 `533013eb6f420529371e493edd2376fd5bd5a11381a1cfafab6795338514be24`.
- Embedded `friday-browser.js`: 1,753,282 bytes; SHA-256 `3084b94c6a710d4342aec7b3b8c3ac01615326e3bc7d34d55063127c8a0aaf18`.

## Guard behavior

The R38 guard must inspect all three backend artifacts through no-follow descriptors, require one regular link, exact mode/owner/size/hash, require one fixed service identity, chain to the exact R36 guard, and require these exact environment entries:

```text
PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS=10
PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS=2
```

Fixture checks passed for authority, coordinator, and site. The backend guard rejected the old 30/5 policy and a missing skew key. Unit analysis emitted only the expected diagnostics for not-yet-installed `/opt` release paths.

## Compatibility and recovery

- Preserve all seven existing recipient-pending rows, their exact operation IDs, terminal notices, missing request-digest states, mint-effect evidence, runtime database, WAL/SHM files, and independent anchors.
- Do not acknowledge, relabel, delete, or reset them. Their fake balances remain excluded from fresh-profile acceptance accounting.
- V1 legacy package authorization remains actor-key based. V2 and V3 remain payment-key based.
- V3 requires both the seller actor and seller payment key from participant-authenticated auction state to match the valid seller-signed catalog.
- The browser durably persists the exact abort capsule in `coco_locked` before constructing or verifying the winner envelope. A structural V3 refusal therefore retains the exact recovery path for the already locked funding operation.

## Approval-gated activation outline

Activation still requires a separate destructive-action approval. On approval, follow the complete R1 sequence with only these substitutions:

1. Recheck source/artifact hashes, live service paths/restarts, seven-operation inventory, absence of both payout stores, authenticated public WebSocket behavior, APP NTP health, and at least five fresh authenticated H+1 samples inside 10/2.
2. Fence new work and take one non-overwriting, metadata-preserving backup of the full runtime, WAL/SHM files, independent anchors, environment, units, nginx state, and predecessor release/guards.
3. Verify the backup manifest and copied SQLite integrity read-only.
4. Install R38 and R16 into new directories without overwriting R36/R14 or the undeployed R37/R15 preparation.
5. Add exactly the two 10/2 environment entries and run both successor guards before any unit change.
6. Create the two auction-payout stores once, as the runtime owner, only after proving both targets absent. Any pre-existing path is a stop condition.
7. Install successor units, rerun guards, then start coordinator, authority, and site in that order.
8. Reconcile the seven legacy rows without acknowledgement or mint effects, then execute the unchanged R1 five-profile fake-sat acceptance workflow.

## Remaining blockers

- Separate approval for service stop, backup, environment edit, store initialization, install, unit change, and service start.
- Fresh live APP NTP/clock and authenticated H+1 evidence inside 10/2.
- Authenticated public WebSocket verification through nginx.
- A stable source checkpoint coordinated with the GitHub publication work.
- Full fresh-profile fake-sat acceptance, including offline seller, outbid import, restart recovery, automatic close, winner payout, exact balances, and final conservation.

Until those pass, R38/R16 are isolated local candidates, not deployed or live-verified releases.
