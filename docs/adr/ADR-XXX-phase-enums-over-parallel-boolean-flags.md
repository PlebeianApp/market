# ADR-XXX: Phase enums (state machines) instead of parallel boolean flags

## Status

Proposed

## Date

2026-07-17 (consolidated 2026-07-27 with `ADR-payment-lifecycle-state-machine.md`)

## Related

- Reinforces constraint from root `AGENTS.md` (lines 41–47): "Do not collapse
  payment lifecycles into booleans"
- Same constraint repeated in `src/AGENTS.md`, `src/lib/AGENTS.md`,
  `src/queries/AGENTS.md`, `src/publish/AGENTS.md`, `src/hooks/AGENTS.md`
- Supersedes the ad-hoc boolean payment state in
  `LightningPaymentProcessor.tsx` and `DepositLightningModal.tsx`
- `src/lib/payments/proof.ts` — `PaymentProof` union (existing
  discriminated-union precedent this ADR follows)

## Context

The root `AGENTS.md` already prohibits collapsing payment lifecycles into
booleans — the constraint lists 10 distinct lifecycle states (requested,
attempted, wallet acknowledged, settled/proven, receipt published, merchant
confirmed, expired, failed, refunded, fulfilled). This rule appears in **6 of
12 AGENTS.md files** across the repository.

However, the guidance does not specify a **concrete type-level pattern** for
how to model these states. The most prominent violation remains in production:

`LightningPaymentProcessor` (`src/components/lightning/LightningPaymentProcessor.tsx`,
869 lines) tracks its payment flow with three independent `useState<boolean>`
flags:

```typescript
const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false) // L115
const [isPaymentInProgress, setIsPaymentInProgress] = useState(false) // L116
const [isCheckingForReceipt, setIsCheckingForReceipt] = useState(false) // L117
```

These encode a sequential lifecycle (generate → pay → check → done) but
nothing prevents **impossible states** — e.g., `isGeneratingInvoice=true AND
isPaymentInProgress=true` simultaneously:

| isGeneratingInvoice | isPaymentInProgress | isCheckingForReceipt | Meaningful?                                           |
| ------------------- | ------------------- | -------------------- | ----------------------------------------------------- |
| true                | true                | false                | No — cannot generate and pay simultaneously           |
| false               | true                | true                 | No — sequential coupling not represented              |
| true                | false               | true                 | No — cannot generate and check receipt simultaneously |
| true                | true                | true                 | No — undefined behavior                               |

With N independent booleans, the type system permits `2^N` states, but only
`N + 1` are valid. The remaining `2^N - N - 1` states are bugs waiting to
happen.

**Note:** The `hasCompletedRef` reset bug flagged in earlier analysis was
already fixed on master (two reset paths added at L647 and L676). The
boolean anti-pattern itself remains.

## Decision

Lifecycle phases in React components will be modeled as a **discriminated
union** (phase enum) driven by a single `useReducer`, rather than parallel
`useState<boolean>` flags. A payment is always in exactly one phase;
transitions are explicit, named, and validated by the reducer. Every code
path — NWC, NIP-60, WebLN, manual verify, zap monitor — funnels through one
switch instead of independently flipping booleans.

`useReducer` is preferred over `useState<PaymentPhase>` because the reducer
centralises transition validation: invalid transitions (`attempting` from
`awaiting_receipt`, self-transitions on terminal states, etc.) are rejected
in one auditable place rather than scattered across callbacks. The reducer is
the only place that mutates phase.

For `LightningPaymentProcessor`, the three booleans (and their escape-hatch
refs `hasCompletedRef`, `walletPreimageRef`) will be replaced by a single
`PaymentPhase` value:

```typescript
export type PaymentPhase =
	| { kind: 'idle' }                                                          // 0. nothing requested yet
	| { kind: 'invoice_requested' }                                             // 1. invoice generation kicked off
	| { kind: 'invoice_ready'; bolt11: string }                                 // 2. bolt11 in hand, no attempt yet
	| { kind: 'attempting'; method: WalletPaymentMethod | 'webln' | 'manual' }  // 3. wallet call in flight
	| { kind: 'wallet_acked'; method: WalletPaymentMethod; atMs: number }       // 4. wallet returned, no proof yet
	| { kind: 'awaiting_receipt'; mode: 'polling' | 'zap_monitor' | 'qr_passive'; invoice: string } // 5. polling or passive monitoring for receipt/proof
	| { kind: 'settled'; proof: PaymentProof }                                  // 6. cryptographic proof obtained
	| { kind: 'failed'; reason: PaymentFailure }                                // 7. unrecoverable failure
	| { kind: 'expired' }                                                       // 8. invoice expiry hit before settle

const [phase, dispatch] = useReducer(paymentPhaseReducer, { kind: 'idle' })
```

### `wallet_acked` vs `settled` (AGENTS.md §45)

`wallet_acked` and `settled` are deliberately distinct phases. A wallet
returning success (e.g., NWC `pay_invoice` resolves, WebLN `sendPayment`
returns) only proves the **wallet accepted the request** — it does not prove
the Lightning invoice was settled. Reaching `settled` requires a
`PaymentProof` carrying a preimage or zap receipt. The default reducer path
routes `wallet_acked → awaiting_receipt → settled`; a `wallet_ack` marker
alone must **not** jump directly to `settled`. This satisfies
`AGENTS.md` §45 ("Do not equate wallet acknowledgement ... with settlement")
at the type level. An opt-in to treat `wallet_ack` as `settled` is permitted
only when maintainer direction explicitly defines that behaviour for a given
flow.

### `PaymentFailure` discriminated union

Failures are themselves discriminated, so consumers can pattern-match on the
specific reason rather than parsing a free-text error string:

```typescript
export type PaymentFailure =
	| { reason: 'wallet_error'; error: string }
	| { reason: 'no_receipt'; timeoutMs: number }
	| { reason: 'invalid_preimage' }
	| { reason: 'user_aborted' }
```

The existing `PaymentProof` union is reused unchanged — the state machine
only *wraps* it in `settled`, never alters its semantics.

### Rule for future code

> **Any component with 3+ boolean `useState` flags that collectively represent
> phases of a single lifecycle MUST use a discriminated union type (driven by
> a reducer) instead.**

Two flags may be permitted if they are genuinely orthogonal (e.g.,
`isExpanded` and `isLoading` on unrelated concerns). Three or more flags that
describe a sequential process must be consolidated.

This rule makes the existing AGENTS.md constraint ("Do not collapse payment
lifecycles into booleans") mechanically enforceable — the type system rejects
impossible states rather than relying on convention.

## State-transition diagram

```
                       ┌──────────────────────────────────────────────┐
                       ▼                                              │
   idle ──► invoice_requested ──► invoice_ready ──► attempting ───────┤
                │                         │              │            │
                │ fail                    │ expired      │ wallet_err │
                ▼                         ▼              ▼            │
              failed                   expired         failed         │

   attempting ──► wallet_acked ──► awaiting_receipt ──► settled
                       │                  │
                       │ no proof path    │ timeout
                       │ (wallet_ack)     ▼
                       └─────────────► settled*  (* AGENTS §45: wallet_ack ≠ settled
                                                  unless maintainer defines it —
                                                  default path requires proof)

   From any non-terminal phase ──► failed (user_aborted)
```

Self-transitions (e.g. `attempting → attempting` on retry) are rejected by
the reducer. Terminal states (`settled`, `failed`, `expired`) emit a no-op on
further dispatches, which replaces the `hasCompletedRef` guard.

The `awaiting_receipt` phase subsumes both the active polling path
(`mode: 'polling'`) and the passive QR-code monitoring path
(`mode: 'qr_passive'`). The latter previously had **no** boolean
representation — all three flags were false while the background `useEffect`
(L293) actively monitored. Making it an explicit phase removes that implicit
"all-false-but-live" state.

## Bug Prevention Table

Every confirmed bug maps to a structural prevention mechanism in the new
state machine — the fix is in the types and the reducer, not in discipline.

| # | Bug (current code) | Severity | Prevention mechanism |
|---|---|---|---|
| **1** | **Double-pay race** (L387–391, 458–462, 523–527). `isPaymentInProgress` is `false` during `awaiting_receipt`, so `disabled={isPaymentInProgress}` re-enables the pay button while a zap receipt is still pending. | MEDIUM | Reducer only allows `attempting` from `invoice_ready`. While in `awaiting_receipt`, dispatch is a no-op. Pay button cannot re-arm on a live invoice. |
| **2** | **Stale-flag window** (L273/279). Two flags set from different callbacks race, leaving a frame where both are false but payment is still live. | LOW | Single phase value — no "between flags" frame is representable. The phase is atomic per dispatch. |
| **3** | **Settlement conflation** (L398, 469, 534). `handlePaymentSuccess({ type: 'wallet_ack' })` treats wallet "said yes" as settled with no preimage. Violates AGENTS §45. | LOW | `wallet_acked` is distinct from `settled`. Reaching `settled` requires a `PaymentProof` (preimage / zap receipt), not a `wallet_ack` marker. |
| **4** | **Re-entry after failure.** `hasCompletedRef` guards success but a failed NWC path resets `isPaymentInProgress=false` (L401) without marking terminal, so a subsequent WebLN click starts a fresh attempt on the same invoice. | MEDIUM | `failed` is terminal. Recovery requires an explicit `reset` action — no boolean to flip back. `hasCompletedRef`'s failure-side gap is eliminated. |
| **5** | **Manual-verify blind spot** (L118). The `manualPreimage` flow has no dedicated flag — none of the 3 booleans reflect "awaiting manual confirmation". | LOW | `attempting` with `method: 'manual'` covers it. Button gated on `phase.kind === 'invoice_ready'`, so "awaiting manual confirmation" is a real phase, not a side check. |
| **6** | **Expired invoice reuse.** No expiry handling in the booleans — an expired bolt11 can still drive an `attempting` click. | MEDIUM | `expired` is terminal. An invoice-expiry timer dispatches it; `attempting` from `expired` is rejected. Background monitoring keys off `phase.kind` and stops cleanly. |
| **7** | **`handleSkipPayment` partial cleanup** (L603–611). Skip leaves a partial boolean set, then later cleanup forgets to clear it. | LOW | Terminal states no-op. Skip dispatches a terminal phase; there is no partial boolean set to forget. |

## Scope Clarification

`AGENTS.md` §41 enumerates **10** lifecycle states. Not all of them belong in
`LightningPaymentProcessor` — that component tracks the **client-payment**
layer, not the merchant/server-side order consensus layer. The 9 phases above
cover the client-payment lifecycle. The remaining 4 states belong to a
**separate future order-consensus reducer** that this component cannot
authoritatively set:

| Layer | §41 states | Owner |
|---|---|---|
| **Client-payment** (9 — this ADR) | requested (`invoice_requested`), attempted (`attempting`), wallet acknowledged (`wallet_acked`), settled/proven (`settled`), expired, failed, plus `idle`, `invoice_ready`, `awaiting_receipt` | `LightningPaymentProcessor` / client-side payment reducer |
| **Order consensus** (4 — future reducer) | receipt published, merchant confirmed, refunded, fulfilled | server / order reducer — *not* client UI to set unilaterally |

Conflating the two layers is itself an `AGENTS.md` §45 violation. The
client-payment reducer observes order-layer events but does not author them.
A future ADR should define the order-consensus reducer separately; until
then, `fulfilled` (and `refunded`) must not appear in `PaymentPhase`.

## Skip-Payment Exclusion

The `PaymentPhase` union **structurally excludes** a `skip_payment` state.
Payment is a mandatory phase of the order lifecycle in the current model: an
order transitions through `invoice_ready → attempting → settled` (or fails).
There is no variant that lets a flow jump from `invoice_ready` directly to a
terminal success without payment.

This exclusion is **intentional and aligns with maintainer direction**.
@maximotodev confirmed on PR #1164 that the payment step is not optional for
the standard order flow; introducing a skip capability would require
explicit maintainer approval and a coordinated change to the order-consensus
reducer, not a quiet addition to the client-payment type.

Upstream PR [#165 (plebomoto)](https://github.com/PlebeianApp/market/pull/165)
proposes adding a skip-payment capability. **If #165 merges**, implementation
PRs in this repo must implement skip-payment as a *capability toggle* that
is wired through the order reducer and the component's action surface —
**not** by adding a `skip_payment` variant to `PaymentPhase`. Keeping the
phase enum closed forces skip logic to live at the action/order layer where
the maintainer decision is explicit, rather than hiding it inside the payment
state machine where it would re-introduce the "impossible state" problem this
ADR exists to prevent.

In short: the type is closed to skip-payment on purpose. Skip, if it arrives,
is an *action* (dispatched and authorised by the order layer), never a
*phase*.

## Test Coverage Gap

**This is the dominant risk factor for any refactor.** Only the **WebLN happy
path** is covered by e2e (`e2e/tests/order-lifecycle.spec.ts`). The following
are completely untested:

- NWC payment path
- NIP-60 payment path
- Manual preimage entry
- All failure paths (`wallet_error`, `no_receipt`, `invalid_preimage`, `user_aborted`)
- Invoice expiry
- Double-pay / re-entry guards
- The `wallet_acked` → `awaiting_receipt` → `settled` transition specifically

No unit tests exist for `LightningPaymentProcessor`. Before the booleans are
removed (PR 3 below), each phase transition must have at least one test —
otherwise the refactor substitutes one set of unverified behaviors for
another. The reducer itself is the cheapest unit-test surface: it is a pure
function of `(state, action)` and should be exhaustively tested before any
component wiring changes.

## Enforcement

**Lint rule (preferred).** Add a project ESLint rule (or
`eslint-plugin-local`) targeting `src/components/lightning/`,
`src/feature/wallet/`, and `src/lib/stores/` that flags `useState<boolean>`
variables matching `/^is(Paying|Processing|Pending|Checking|Generating)/`
when the file also imports from `@/lib/payments/*`. The rule suggests
`usePaymentPhaseReducer`. This catches the 198 existing matches surfaced by
the audit without a blanket boolean ban.

**Code review checklist (fallback).** When a lint rule is infeasible:

- [ ] Does the component hold a single `PaymentPhase` driven by a reducer,
      not parallel `useState<boolean>` flags?
- [ ] Are all terminal states (`settled`, `failed`, `expired`) unreachable
      for further transitions?
- [ ] Is `wallet_acked` ever equated with `settled` without explicit opt-in
      (AGENTS §45)?
- [ ] Does every wallet call site dispatch through the reducer, not set
      state directly?
- [ ] Is the pay button `disabled` for every phase except `invoice_ready`?

## Invariants

- Only one phase is active at any time — the type system enforces this.
- Phase transitions are explicit and validated by the reducer; invalid
  transitions are no-ops.
- The phase carries its own payload (e.g., `method` for `attempting`,
  `bolt11` for `invoice_ready`, `proof` for `settled`, `reason` for
  `failed`) rather than separate state variables.
- Phase checks use exhaustive pattern matching (`switch (phase.kind)`) so
  adding a new phase is a compile error in every consumer until handled.
- Refs (`hasCompletedRef`, `hasRequestedInvoiceRef`) remain for imperative
  guards but their role is reduced — the phase itself becomes the primary
  source of truth.
- The `PaymentPhase` union is **closed** to order-consensus states
  (`fulfilled`, `refunded`, `receipt_published`, `merchant_confirmed`) and to
  a `skip_payment` variant (see sections above).

## Consequences

### Positive

- **Impossible states are unrepresentable**: the compiler rejects
  `isGeneratingInvoice && isPaymentInProgress` because there is no phase with
  both properties.
- **Validated transitions**: the reducer is the single chokepoint; race-prone
  multi-flag writes collapse into one atomic dispatch.
- **Exhaustive checking**: `switch (phase.kind)` produces a compile error
  when a new phase is added but not handled.
- **Richer state per phase**: `attempting` carries `method` (eliminating a
  parallel `paymentMethod` state variable); `settled` carries `proof`;
  `failed` carries a structured `reason`.
- **Simpler effects**: the background-monitoring effect keys off
  `phase.kind === 'awaiting_receipt'` instead of the current
  `!isGeneratingInvoice && !isPaymentInProgress && !hasCompleted`.
- **Self-documenting**: the phase type documents the component's lifecycle in
  one place.

### Costs

- **Migration effort**: `LightningPaymentProcessor` is ~870 lines and touches
  the booleans in ~12 locations across generation, payment, monitoring, and
  error handlers. An audit found **198 matches** for the banned boolean
  pattern (`isPaying`, `isProcessing`, `isPending`, `isChecking`,
  `isGenerating`) across `src/` in files that import from `@/lib/payments/*`.
- **Render logic changes**: `isGeneratingInvoice` checks in JSX become
  `phase.kind === 'invoice_requested'` — slightly more verbose in templates.
- **Transitional period**: until the migration lands, the booleans remain,
  and reviewers must be vigilant about not adding new boolean phase flags.
- **Learning curve**: contributors unfamiliar with discriminated unions and
  reducers need to understand exhaustive switch patterns.
- **Reducer test burden**: the reducer must be exhaustively unit-tested
  before component wiring changes — but this is also the cheapest test
  surface in the refactor.

## Rollout / PR sequence

### PR 1 — Define `PaymentPhase` type and reducer

Introduce the `PaymentPhase` type, the `PaymentFailure` union, and the
`paymentPhaseReducer` (a pure function) alongside the existing booleans. Add
a `usePaymentPhaseReducer` hook whose `dispatch` also sets the corresponding
booleans as a transitional bridge. No behavior changes; reducer is unit-tested
exhaustively here.

### PR 2 — Migrate read sites

Replace all `isGeneratingInvoice` / `isPaymentInProgress` /
`isCheckingForReceipt` read sites with `phase.kind === ...` checks. Remove
the boolean-derived guards from effects. Keep booleans as write-only mirrors
during this PR.

### PR 3 — Migrate write sites and remove booleans

Replace all `setIsGeneratingInvoice(true)` etc. with
`dispatch({ type: 'invoice_requested' })`. Remove the boolean state
variables and the transitional bridge.

### PR 4 — Enrich phase payloads and simplify refs

Move `paymentMethod` into the `attempting` phase variant. Evaluate whether
`hasCompletedRef` can be replaced by `phase.kind === 'settled'`.

### PR 5 — Audit other components for the 3-flag anti-pattern

Search for components with 3+ boolean `useState` flags and evaluate whether
they represent lifecycle phases. File issues for any that should be migrated.
`DepositLightningModal.tsx` is the next-highest-churn candidate.

## Notes

The AGENTS.md constraint "Do not collapse payment lifecycles into booleans"
(lines 41–47) was established independently by the project maintainers before
this ADR. This ADR makes that constraint concrete: it specifies the
TypeScript pattern (discriminated union driven by a reducer) that implements
the rule, and it provides a migration path for the most prominent violator
(`LightningPaymentProcessor`).

The AGENTS.md itself says: "Do not use AGENTS text as proof that behavior
already exists." The code does not yet comply with the constraint it
documents. This ADR is the implementation plan to close that gap.

This ADR consolidates the earlier `ADR-payment-lifecycle-state-machine.md`
(useReducer mechanism, `wallet_acked` vs `settled` distinction,
`PaymentFailure` union, and the state-transition diagram) into the
phase-enums frame. That document is superseded and removed; the 9-phase
client-payment model here is the single source of truth. Order-consensus
states (`receipt_published`, `merchant_confirmed`, `refunded`, `fulfilled`)
are deliberately out of scope and belong to a future order reducer.

`src/lib/payments/proof.ts` is referenced because `PaymentProof` is the
existing discriminated-union precedent in this repo — `PaymentPhase` follows
the same shape rather than inventing a new pattern.
