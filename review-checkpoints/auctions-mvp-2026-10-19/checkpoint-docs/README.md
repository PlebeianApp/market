# Auctions MVP checkpoint documentation

Date: 2026-10-19 UTC  
Evidence snapshot: 2026-10-19T16:17:05Z  
Target repository: `PlebeianApp/market`  
Checkpoint state: documentation plus frozen-source publication planning; no publication has occurred

## Read this first

This is a maintainer review checkpoint, not a runnable release. It is **not demo-ready**, **not safe for real funds**, and **not production-safe**. There has not been a successful full FIPS/payment end-to-end run.

This statement applies to the nested `checkpoint-docs/` subpacket: no source tree, dependency bundle, wallet material, service configuration, key, or deployment artifact is included here. The enclosing WIP package includes separate `source-review/` base, delta, patch, contract, manifest, and seal evidence. That evidence remains historical, blocked, incomplete, and non-runnable. GitHub and ngit publication are outside this documentation phase.

## Plain-language overview

The accepted design is an auction system run by four independent validators communicating over FIPS, the Free Internetworking Peering System. CometBFT is intended to make the validators agree on bids, closing, winners, losers, and the payment authorization selected for each bid.

Agreement on an auction does not move money. Cashu spending has a separate authority boundary. A winning payment needs the bidder's signature plus one committee signature. That committee signature is itself produced by any three of four committee members using FROST. Refunds use a separate bidder refund key and are not eligible before their locktime under the accepted R16 behavior.

The Cashu mint remains trusted for issuance and for deciding which competing valid spend arrives first. A consensus result, FROST signature, or generic `SPENT` status is not proof that the seller or bidder received funds.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the boundaries and races in detail.

## Current checkpoint status

| Area | What is pinned | Current limitation |
|---|---|---|
| Architecture | Accepted ADR-001, copied verbatim in this directory | Acceptance does not prove implementation or deployment |
| Payment/FROST | R4.3 contract is accepted; its initial implementation is frozen as historical WIP | Independent A2/A3 review verdict is `BLOCKED`; repair is active and no successor bytes are frozen |
| FIPS/UI | R5 Phase 1 is frozen as historical WIP | Independent review verdict is `BLOCKED`; repair is active and production storage/runtime wiring is absent |
| Storage V2 | Last frozen reconciliation seal is blocked | M4 retained-history repair is still in progress; no older storage source may be substituted |
| Composed system | No accepted composed candidate | No successful full FIPS/payment end-to-end run |
| Publication | GitHub `PlebeianApp/market` branch `wip/auctions-mvp-checkpoint-2026-10-19`; authorized new public ngit repository `auctions-mvp` under the verified owner identity | Command/workflow review is complete; authentication remains unresolved and nothing was created or pushed |

## Contents

- [ADR-001-INDEPENDENT-FIPS-AUCTIONS.md](ADR-001-INDEPENDENT-FIPS-AUCTIONS.md) — accepted architecture, preserved without renumbering or edits.
- [ARCHITECTURE.md](ARCHITECTURE.md) — maintainer explanation of consensus, payment, mint, recovery, and storage boundaries.
- [OFFLINE-REVIEW.md](OFFLINE-REVIEW.md) — evidence-safe review procedure and the limited commands already present in lane logs.
- [KNOWN-BLOCKERS.md](KNOWN-BLOCKERS.md) — release, integration, storage, and publication blockers.
- [PROVENANCE.md](PROVENANCE.md) — pinned document and seal identities.

## WIP review publication checklist

- [ ] Publish only the pinned immutable predecessor bases, patches/deltas, status documents, and provenance selected for review; do not copy active implementation worktrees.
- [ ] Label both Payment R4.3 and FIPS/UI R5 Phase 1 `BLOCKED` historical WIP.
- [ ] State prominently that the curated evidence directory is not a self-contained runnable distribution.
- [ ] Verify every included byte against [PROVENANCE.md](PROVENANCE.md) and a new checkpoint-wide manifest.
- [ ] Require A4 to verify the stable publication bytes independently.
- [ ] Keep real wallets, mints, keys, relays, services, and funds out of this checkpoint.
- [ ] Resolve authentication for GitHub and for authorized public ngit repository `auctions-mvp` under `npub165ka9706vpl8phnw0w5wh89za8nnl56dajz92h6e2m9uxxvkz6wszt0gn5` (`maximotodev@maximotodev.vercel.app`).
- [ ] Preserve separate GitHub and ngit histories/layouts; do not describe them as the same commit or tree.

The existing owner request authorizes this truthful WIP review publication after stable-byte/A4 verification, privacy scanning, and authentication. Repair completion, dependency closure, independent implementation acceptance, and full-system testing remain integration/demo gates, not prerequisites for publishing historical progress. No redundant owner reauthorization is implied.

## What this checkpoint does not claim

It does not claim live FIPS connectivity, four independently operated validators, production consensus, dealerless DKG, real FROST signing, live mint compatibility, seller settlement, bidder refund delivery, crash-safe cross-host failover, complete Storage V2 migration, or 24/7 operation.

