# Task: PR #1144 Follow-up — Deferred Improvements

## Status

Deferred — not blockers, tracked for future improvement. The protocol is
in beta; these can be addressed incrementally.

## Source

Identified during self-review of PR #1144 (`feat/settlement-steps`)
after the settlement fixes landed. Each item was assessed as valid but
not a merge blocker.

## Items

### 1. `nut7_not_spent → valid` settlement validity is a trust assumption

A settlement where proofs aren't spent is considered `valid`. If the
seller never redeems, the settlement sits on the relay as `valid`
forever. The settlement window (locktime) is the actual safety
mechanism (bidder refunds at locktime regardless), but the code doesn't
make this obvious. The `settlement-pending-redemption` badge helps, but
a reviewer may want explicit documentation that the badge means
"structurally well-formed" not "confirmed redemption."

**Fix direction:** Document in the settlement descriptor that
`settlement-pending-redemption` is a structural-validity badge, not a
redemption-confirmation badge. The locktime is the safety mechanism.

### 2. `skipCashuTokenCheck` removes a fraud detection layer from the validator

The validator no longer validates cashu token contents in path releases.
A malicious bidder could publish a path release with a token containing
wrong proofs (wrong amounts, wrong secrets, proofs that don't match the
bid's `proof_y` tags). The client-side `isValidPathRelease` still
validates, but the validator's verdict is the quorum signal.

**Fix direction:** At minimum, the validator should check that a
`cashu_token` tag EXISTS (even without decoding it). Consider also
checking proof count and that the token mint matches the bid mint —
these don't require keyset info.

### 3. `assignLateValidLoserRole` winner demotion has a relay-state gap

When a late-valid bid becomes the winner, it demotes any
previously-assigned winner in-memory. But the demoted bid may already
have a `won_pending_settlement` verdict on the relay. The demotion
only changes in-memory state; `publishIfChanged` should re-publish the
demoted bid as `lost_pending_refund` and the new winner as
`won_pending_settlement`.

**Fix direction:** Add a test for the specific scenario: bid A gets
`won_pending_settlement` on the relay, then bid B (higher) becomes
valid post-close → demotion → does the validator re-publish A as
`lost_pending_refund`?

### 4. The d-tag change is a hard breaking change with no migration path

Existing verdicts on relays use the 2-part `bidder:auction` d-tag. The
parser now rejects them (the refine check requires 3-part). Validators
that haven't updated will keep publishing 2-part d-tag verdicts that
the new parser drops.

**Fix direction:** Either a backwards-compatible parser (accept both
formats), or a documented migration (clear the relay, coordinated
rollout). At minimum, document the breaking change in the ADR.

### 5. `observed_at` recovery is best-effort with a silent failure mode

If the relay is unreachable or returns no prior verdicts, the recovery
returns an empty seed and falls back to `now()` — the exact bug the
recovery was meant to fix (restart-after-close re-stamping
`observed_at = now()` → `late_arrival`).

**Fix direction:** Persist a minimal `(bidEventId → observedAt)` map
to a local file so recovery doesn't depend on relay availability.

### 6. Pre-publish gate uses aggregate NUT-7, cannot distinguish partial-spend from all-spent

The pre-publish gate (`validateBidChainNut7PrePublish`) checks the
aggregate state per bid via `aggregateBidNut7State` (in
`src/lib/cashu/nut7.ts`). This function returns `'spent'` if **ANY**
proof is spent (early return on first spent), not just when ALL proofs
are spent. So a partial-spend leg (e.g. 1 of 2 proofs spent) aggregates
to `'spent'` and is silently skipped by the gate as "already
redeemed" — when it's actually fraud (early-exit double-spend).

M6's per-proof check (step 5b) catches it later and throws "partial
spend detected," so the settlement still aborts correctly — but the
gate's stated purpose is to be stricter than the read path, and here
it is less precise. The seller also wastes work between steps 4b and
5b (path-release validation, token binding) on a settlement that will
fail.

Note: `aggregateProofStates` (in `src/server/auction-validator/state.ts`)
has different semantics — it requires ALL spent to return `'spent'`.
The two functions disagree on partial spends.

**Fix direction:** Either (a) change `aggregateBidNut7State` to only
return `'spent'` when ALL proofs are spent (matching
`aggregateProofStates`), or (b) have the gate query per-proof states
directly instead of using the aggregate, or (c) at minimum document
that partial-spend detection is deferred to M6's per-proof check in
step 5b. Option (a) is the smallest change but would change the
aggregate's semantics for all callers; verify no other caller relies
on the any-spent behavior. Option (b) is more precise but requires the
gate to accept per-proof states instead of the aggregate map.

### 7. Test coverage gaps for multi-validator and restart scenarios

Most tests use a single validator (`auditorQuorum: 1`).

**Fix direction:** Add multi-validator quorum tests (quorum of 2-3,
with one validator going down), restart-after-close with a rebid chain
(the exact scenario that caused the original bug), and multiple
validators publishing conflicting verdicts for the same bid.

### 8. `settlement-pending-redemption` badge doesn't block actions

The badge changes the text but doesn't disable the "Publish Settlement"
button or add a warning.

**Fix direction:** Consider whether a `settlement-pending-redemption`
badge should block re-publishing, or whether a "Confirm Redemption"
action should check NUT-7 `spent` before allowing the full
`settlement` badge.

## Priority

All items are non-blocking. Suggested order:

1. #2 (cashu_token tag exists check) — smallest change, highest value
2. #3 (winner demotion re-publish test) — correctness verification
3. #6 (partial spend aggregate test) — edge case coverage
4. #4 (d-tag migration documentation) — coordination requirement
5. #5 (observed_at persistence) — robustness improvement
6. #7 (multi-validator tests) — coverage improvement
7. #1 (badge documentation) — UX clarity
8. #8 (badge action blocking) — UX improvement
