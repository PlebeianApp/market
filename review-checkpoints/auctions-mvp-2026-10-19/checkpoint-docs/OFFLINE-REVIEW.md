# Offline review guide

Evidence snapshot: 2026-10-19T16:17:05Z

## Purpose and limits

Use this guide only after immutable source snapshots are supplied and their seals are verified. The nested `checkpoint-docs/` subpacket does not contain source. The enclosing WIP package includes separate `source-review/` historical evidence, but that subset lacks the source and dependency closure needed to run the commands below.

The commands in this file are limited to source-relative, offline commands already recorded in lane logs. They are historical evidence for their original lane candidates, not proof for a future assembled checkpoint. Do not install dependencies, fetch packages, start services, connect wallets or mints, open listeners, or use keys or real funds to make them run.

## Prerequisites

- An immutable source snapshot supplied by A0, not a copy of an active implementation worktree.
- Exact candidate manifests and lane seals from [PROVENANCE.md](PROVENANCE.md).
- The dependencies already present in the snapshot/cache. Missing dependencies are a blocker, not permission to install them.
- Bun `1.3.11` for the three commands below, matching the recorded logs.
- A clean, isolated, network-disabled review workspace with no wallet, mint, signer, or production configuration.

The Go R5 logs used a host-specific absolute toolchain and cache path, so this public guide does not rewrite that invocation into an invented portable command. Storage reconciliation likewise references a separate command ledger that is not reproduced here. A4 should record an approved source-relative invocation only after the immutable snapshots and toolchain identity are frozen.

## Evidenced offline commands

Run from `market-app`:

```sh
bun test ./e2e/demo-payment-coordinator.e2e.ts
```

The current lane log reports 15 passing tests and 0 failures for its then-current Payment V2 candidate.

Run from `cashu-wrapper/ts`:

```sh
bun test ./demo-maintainer-offline.test.ts
bun test ./demo-sigall-recovery.test.ts
```

The current lane logs report, respectively, 14 passing tests with 0 failures and 17 passing tests with 0 failures.

These results belong to the frozen initial Payment R4.3 implementation. Independent A2/A3 review later returned `BLOCKED`; the green focused tests do not resolve those integration findings and do not constitute acceptance or a composed-candidate seal.

## Reviewer checklist

- [ ] Verify the copied ADR hash before using it as normative authority.
- [ ] Verify the historical blocked Payment R4.3 implementation seal, FIPS/UI R5 Phase 1 successor seal, and the latest blocked Storage V2 seal-file hashes.
- [ ] Verify the exact R4 → R4.1 → R4.2 → R4.3 contract chain; R4.3 changes only the existing membership-field count from six to five.
- [ ] Confirm source snapshots are immutable and do not point into active implementation worktrees.
- [ ] Record branch/base/candidate identities supplied with each snapshot and confirm no unlisted file drift.
- [ ] Run the smallest applicable source-relative command above with networking disabled.
- [ ] Record the exact candidate hash, command, tool version, exit code, pass/fail/skip counts, and fixture assumptions.
- [ ] Treat any missing dependency, absolute host path, listener requirement, or external service request as `NOT_RUN`, not permission to repair the environment.
- [ ] Verify that missing storage authority, ambiguous mint recovery, pre-locktime refund requests, and commitment drift all fail before payment effects.
- [ ] Require independent lane review and final A4 review of the assembled frozen bytes before publication.

## Known test limitations

The evidence does not include a successful full-system test covering four independent VPS operators, a FIPS mesh, CometBFT consensus, the production storage adapter, real DKG/FROST shares, a live Cashu mint, recipient import, and restart/recovery in one run.

The following remain untested or not established for the assembled system:

- live FIPS transport, peer admission, partitions, reconnect, rekey, or public-network fallback;
- a four-node Comet validator fleet and Byzantine/availability behavior;
- production runtime wiring from immutable Storage V2 history into payment;
- M>1 V1-to-V2 storage migration;
- target-mint enforcement of the unsigned output-keyset constraint;
- both orders of the post-locktime MAIN/REFUND first-spend race against a live mint;
- dealerless DKG and all real 3-of-4 signer subsets across independent hosts;
- physical power-loss behavior, cross-host recovery fencing, rollback protection, and 24/7 operation;
- real-fund settlement or refund delivery.

Historical limitations also include an isolated UI typecheck that lacked sibling monorepo packages and a batch-tool suite that was not run because it starts loopback listeners. Green focused tests do not erase these gaps.

## Required review outcome

A review should report evidence and blockers, not a readiness label. Until immutable assembly and independent composed verification exist, the correct checkpoint conclusion is: not demo-ready, not real-fund-safe, and not production-safe.

