# Plebeian Auctions MVP: contributor candidate

**Fake sats only. Source for review, not an accepted release or deployment.**

This branch brings the 2026-11-06 payment-recovery candidate onto public
checkpoint `a89e0783c2761883f95f6ada26b9f3fbf486d50c`. It is a Go auction
application with a TypeScript/Coco wallet integration, CometBFT consensus,
and experimental Rust 3-of-4 FROST signing. It is not the main marketplace app.

Start here:

- [Contributor setup and test commands](CONTRIBUTING.md)
- [Architecture and trust boundaries](docs/contributors/ARCHITECTURE.md)
- [Current verification and acceptance status](docs/contributors/STATUS.md)
- [Source provenance and publication scope](docs/contributors/PROVENANCE.md)

## What this candidate changes

- Auction-scoped seller payout authorization, exact winner selection and durable
  payout recovery, instead of requiring a new seller plan for each bid.
- Per-actor/per-deployment faucet recovery and recovery after a lost response.
- Bounded safe-read retry/pacing and wallet maintenance; no automatic replay
  of mint mutations.
- Auction creation waits for authenticated committed state before payout
  authorization. The regression journey checks two outbid returns and
  conservation of 20,000 fake sats.
- Bounded service restart and nginx route regression fixtures. These are
  review material, not installation instructions.

## Safety and maturity

Never use real funds, real Lightning backends or an existing wallet seed.
Tests use synthetic keys and worthless proofs. Local passing tests are not
proof of production safety, independent cryptographic review, live settlement,
or approval to deploy. The fresh live acceptance journey for this candidate
remains outstanding. Catalogue UI work and the separately blocked consensus
integer-overflow upgrade are not included.

The repository retains older public experiments, deployment templates and
historical evidence for reproducibility. Dates and claims in root-level
`FRIDAY-*`, `FIPS-*`, `STATUS.md`, `SIDEQUEST-STATUS.md`, `RUNBOOK.md`,
`PUBLICATION-MANIFEST.json` and `evidence/` describe earlier revisions, not this
branch. Do not run historical operations commands or target the hosts named
there. Use the contributor guide and current status above first.
