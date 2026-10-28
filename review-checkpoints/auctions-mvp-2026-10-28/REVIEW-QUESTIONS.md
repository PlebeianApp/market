# Maintainer review questions and gates

Date: 2026-10-28 UTC
Publication state: **DRAFT — NOT PUBLISHED**

## Questions for maintainers

1. Is the R20 source delta acceptable in principle once genesis assembly enforces exact `DefaultPolicy()` equality for all non-funding fields?
2. Should the next checkpoint publish source/test progress before B1, or wait until a reviewed B1 receipt and deterministic bundle hash exist?
3. Is the sanitized, hash-pinned attestation of the owner-supplied Claude `ACCEPT_SOURCE_AND_B1_PREPARATION` report sufficient for public maintainer review?
4. Should the separate legacy Wednesday UI/funding candidate appear as a clearly segregated appendix, or remain out of the R20 checkpoint to avoid architectural confusion?
5. Are the proposed evidence redactions sufficient: no private paths, host addresses, operator identities, key material or raw logs?
6. Is the exact-current runtime acceptance sequence correct: policy fix and refreeze, B1, independent B1 review, B2, independent B2 review, integrated rehearsal, then deployment review?
7. What minimum validator-recovery evidence should gate a live demo claim: advancing common height, canonical hash match, expected signatures and a separately rehearsed browser flow?

## Proposed acceptance gates

### G0 — Source-policy closure

- Enforce non-funding equality to `DefaultPolicy()`.
- Add focused negative tests proving a changed duration, skew, increment, extension or receipt TTL is rejected.
- Reissue the source manifest, test receipt and review against the successor bytes.

### G1 — Review record closure

- Preserve the private full report and the publication-safe attestation.
- Keep the report's limitation explicit: operator-reported hashes, no independent computation, no test rerun and no server action.
- Bind any successor verdict to the successor packet, manifest, diff, controller, test and pending-action hashes.

### G2 — B1

- Run B1 once against the exact accepted source.
- Require deterministic browser outputs and a bounded receipt.
- Independently review the actual receipt and candidate hash.

### G3 — B2

- Bind B2 to the reviewed B1 receipt and candidate.
- Run the exact-current offline build/test matrix.
- Do not execute generated binaries as a substitute for the later integrated rehearsal.
- Independently review artifact hashes, test counts, skips and unexpected changes.

### G4 — Validator recovery

- Complete recovery in its separate task with no reset, deletion, key change or chain-data loss.
- Record fresh common-height/hash evidence and subsequent height advancement.
- Treat running units and peer connections as supporting observations, not proof of health.

### G5 — Integrated fake-sat rehearsal

- Use distinct seller and bidder identities.
- Verify funding, auction creation, bid, displacement, refund, close, seller payout and operator-assisted recovery disclosure.
- Verify the intended 3-of-4 FROST/Comet/Coco path and browser NIP-07 behavior.
- Keep real sats and real-value claims out of scope.

### G6 — Publication and deployment decisions

- Review the sanitized checkpoint files and checksums.
- Authorize publication separately from deployment.
- Review staging, rollback, ingress/TLS and firewall evidence before any deployment.
- Do not infer readiness dates or 24/7 availability from this checkpoint.

## Stop conditions

- Any changed source after the successor manifest requires re-test and re-review.
- A missing or mismatched evidence hash stops the relevant gate.
- An ambiguous consensus or payment result remains unknown; it must not be rewritten as success.
- Historical R8 results must not be attributed to R5.
- Validator recovery work must not be merged into this documentation-only checkpoint.
