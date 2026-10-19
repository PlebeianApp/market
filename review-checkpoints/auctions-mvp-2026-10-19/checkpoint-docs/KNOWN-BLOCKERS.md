# Known blockers

Evidence snapshot: 2026-10-19T16:17:05Z

These are checkpoint blockers, not a historical review chronology.

## 1. No immutable assembled candidate

The nested `checkpoint-docs/` subpacket contains documentation only. The enclosing WIP package includes separate immutable Payment and FIPS/UI review evidence under `source-review/`, but it does not contain the complete local source/dependency closure. The current Storage V2 successor has not been supplied, and no composed source candidate exists. Active implementation worktrees must not be used as publication inputs.

Required next evidence for a runnable/integrated candidate: the missing immutable regular-file source closures, exact member and destination maps, the current Storage V2 successor, a composed manifest, and independent A4 verification. These gaps do not prevent publishing pinned blocked source as clearly labeled historical WIP for review.

## 2. Payment R4.3 implementation is independently blocked

The accepted R4.3 document is a delta-only successor. It corrects the count of an already explicit ApprovalV2 membership join from six fields to five and inherits the pinned R4, R4.1, and R4.2 contract.

The initial source implementation is frozen only as historical WIP. Independent A2/A3 review returned `BLOCKED`: V2 helpers were not connected to reachable payment execution; persisted ready checkpoints were not validated strongly enough; and real durable SQLite cutoff/completion wiring and package-provenance checks were incomplete.

Repair is active inside the existing allowlist, but the changing worktree is not a checkpoint input. Required next evidence: a new immutable successor, exact manifest and seal, tests for the repaired reachable execution path, and independent acceptance before composed validation. The accepted R4.3 contract is unchanged; contract acceptance does not accept an implementation.

## 3. FIPS/UI R5 Phase 1 is independently blocked

The frozen R5 Phase 1 snapshot is historical WIP. Independent review returned `BLOCKED` for a Go missing-field/surrogate decoder, missing mint-origin parity, missing committee context, and a public verifier that exists only in test code. The production storage-history adapter and runtime binding path also remain unwired.

Builder repair is active elsewhere. Its changing worktree is not included or represented by this checkpoint.

Missing or drifting history authority must continue to refuse before payment calls. Display/sync HTTP data and in-memory fixture arrays must not be promoted to production authority.

## 4. Storage V2 M4 repair is still in progress

The latest storage candidate reports repairs for orphan alternative replay, checkpoint state-payload binding, and M=1 mapping. Eleven focused top-level app tests were reported.

The last frozen reconciliation remains intentionally fail-closed because its evidence lacks independently retained V1 height-record bytes and the exact V1 replay derivation needed to prove terminal AppHash, roots, and record anchors. M4 repair is in progress. The blocked seal remains provenance only; older source files must not be substituted into a checkpoint.

Required next evidence: an independently generated and reviewed retained-history fixture containing the exact V1 height records, replay seed/step rules, archive graph, M4 migration plan, first V2 checkpoint/marker, and before/at/after-lock cases.

## 5. Mint compatibility and trust remain release gates

The mint is trusted for issuance and first-spend enforcement. NUT-11 `SIG_ALL` does not sign the output keyset id. An application envelope cannot prevent a completed-witness holder from attempting a mutated keyset id directly at the mint.

Required next decision/evidence: a documented target-mint-enforced constraint or an explicit maintainer-accepted economic-equivalence rule, plus compatibility tests against the pinned target mint.

## 6. Refund timing includes a disclosed race

Accepted R16 omits early refund. Refund is ineligible before locktime and is deferred until eligibility. A previously completed MAIN signature can remain valid after locktime, so MAIN and REFUND may race. The mint's atomic first spend decides the result.

This is a disclosed protocol property, not an implementation bug that can be hidden by UI wording. No claim of instantaneous loser refunds is permitted.

## 7. Ambiguous recovery has no blind retry authority

An unknown mint response remains non-terminal. Generic `SPENT`, an opaque retry flag, or local observation cannot select MAIN/REFUND or prove recipient import. Blind resubmission is forbidden.

Required behavior: restore an exact already-established response and import it idempotently, or remain fail-closed for manual resolution.

## 8. Operational and cryptographic gates remain open

The checkpoint does not prove:

- signed roster trust root, rotation/revocation, validator transitions, or strict FIPS link plus routed source/port enforcement;
- a versioned external-evidence authority with freshness, equivocation handling, and retention;
- dealerless DKG, the exact BIP340 FROST profile, durable nonce safety, or all real 3-of-4 subsets;
- safe cross-host failover that demonstrably disables old signing authority;
- live FIPS, Comet, mint, recipient, or 24/7 behavior.

## 9. No successful full FIPS/payment end-to-end run

Focused offline tests cover important pieces, but no accepted run composes FIPS transport, validator consensus, immutable storage history, ApprovalV2, FROST authorization, mint submission/recovery, and recipient import.

The project is therefore not demo-ready, not real-fund-safe, and not production-safe.

## 10. Publication execution is unresolved

The official GitHub target is `PlebeianApp/market` on branch `wip/auctions-mvp-checkpoint-2026-10-19`. The approved ngit destination is a new public repository named `auctions-mvp` under verified identity `npub165ka9706vpl8phnw0w5wh89za8nnl56dajz92h6e2m9uxxvkz6wszt0gn5` with NIP-05 `maximotodev@maximotodev.vercel.app`.

These destinations have different source histories and layouts. No shared commit, identical tree, or fully assembled snapshot is claimed. Exact command and workflow-side-effect review is complete, but authentication remains unresolved. No commit, push, repository creation, Nostr publication, or external communication occurred in this documentation phase.

The existing owner request is sufficient for a truthful WIP review checkpoint once its exact bytes pass privacy and A4 verification and authentication succeeds. Implementation repair, dependency closure, and accepting reviews remain integration/demo gates; they are not WIP-publication prerequisites. Redundant owner reauthorization is not required.

Open questions for A0/owner:

1. Does A0 approve the bounded evidence-directory layout and local-only staging commands in the assembly inventory?
2. What later checkpoint tag, if any, should be used after A4 accepts the stable WIP bytes?
3. Which target mint and keyset policy will satisfy the later release gate?
4. Who owns the sealed production storage adapter and runtime binding files?

