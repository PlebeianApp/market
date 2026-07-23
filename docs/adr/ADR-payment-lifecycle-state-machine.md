# ADR: Payment Lifecycle State Machine

**Status:** Proposed
**Date:** 2026-07-13
**Supersedes:** ad-hoc boolean payment state in `LightningPaymentProcessor.tsx`, `DepositLightningModal.tsx`
**Related:** AGENTS.md §41–44 (payment phase list), `src/lib/payments/proof.ts` (`PaymentProof` union)

## Decision

Replace the scattered parallel booleans (`isGeneratingInvoice`, `isPaymentInProgress`, `isCheckingForReceipt`) and their escape-hatch refs (`hasCompletedRef`, `walletPreimageRef`) with a single discriminated `PaymentPhase` value held in one `useReducer`. A payment is always in exactly one phase; transitions are explicit, named, and validated. This matches AGENTS.md §41–44, which bans boolean-only payment lifecycles, and aligns the component state with the already-discriminated `PaymentProof` type in `proof.ts`. The reducer is the only place that mutates phase, so every code path — NWC, NIP-60, WebLN, manual verify, zap monitor — funnels through one switch instead of independently flipping booleans.

## The `PaymentPhase` type

```ts
export type PaymentPhase =
  | { kind: 'idle' }                                  // 0. nothing requested yet
  | { kind: 'invoice_requested' }                     // 1. invoice generation kicked off
  | { kind: 'invoice_ready'; bolt11: string }         // 2. bolt11 in hand, no attempt yet
  | { kind: 'attempting'; method: WalletPaymentMethod | 'webln' | 'manual' } // 3. wallet call in flight
  | { kind: 'wallet_acked'; method: WalletPaymentMethod; atMs: number }     // 4. wallet returned, no proof yet
  | { kind: 'awaiting_receipt' }                      // 5. zap monitor / polling for receipt
  | { kind: 'settled'; proof: PaymentProof }          // 6. cryptographic proof obtained
  | { kind: 'failed'; reason: PaymentFailure }        // 7. unrecoverable failure
  | { kind: 'expired' }                               // 8. invoice expiry hit before settle
  | { kind: 'fulfilled' }                             // 9. receipt published + merchant confirmed (terminal)
```

`PaymentFailure` is itself a discriminated union (`{ reason: 'wallet_error'; error: string }`, `{ reason: 'no_receipt'; timeoutMs: number }`, `{ reason: 'invalid_preimage' }`, `{ reason: 'user_aborted' }`). The existing `PaymentProof` union is reused unchanged — the state machine only *wraps* it in `settled`, never alters its semantics.

## State transition diagram

```
                       ┌──────────────────────────────────────────────┐
                       ▼                                              │
   idle ──► invoice_requested ──► invoice_ready ──► attempting ───────┤
                │                         │              │            │
                │ fail                    │ expired      │ wallet_err │
                ▼                         ▼              ▼            │
              failed                   expired         failed         │
                                                                       │
   attempting ──► wallet_acked ──► awaiting_receipt ──► settled ──► fulfilled
                       │                  │                 │
                       │ no proof path    │ timeout         │
                       │ (wallet_ack)     ▼                 ▼
                       └─────────────► settled*           failed
                                       (* AGENTS §45: wallet_ack ≠ settled
                                        unless maintainer defines it —
                                        default path requires proof)

   From any non-terminal phase ──► failed (user_aborted)
```

Self-transitions (e.g. `attempting → attempting` on retry) are rejected by the reducer. Terminal states (`fulfilled`, `failed`, `expired`) emit a no-op on further dispatches, which replaces the `hasCompletedRef` guard.

## How it prevents the six bugs

| # | Bug (current code) | Root cause | Prevention |
|---|---|---|---|
| 1 | **Double-pay race.** `isPaymentInProgress` is `false` during `awaiting_receipt` (set at line 388), so `disabled={isPaymentInProgress}` re-enables the pay button while a zap receipt is still pending. | Boolean conflates "in flight" with "settled-ish". | Reducer only allows `attempting` from `invoice_ready` or `idle`. While in `awaiting_receipt`, `attempting` dispatch is a no-op → button stays disabled. |
| 2 | **Stale-flag window.** Lines 273/279 set `isCheckingForReceipt=false` independently of `isPaymentInProgress`, leaving a frame where both are false but payment is still live. | Two flags set from different callbacks race. | Single `phase` value. There is no "between flags" frame; the phase is atomic per dispatch. |
| 3 | **Settlement conflation.** Line 398 routes to `handlePaymentSuccess({ type: 'wallet_ack' })` — i.e. wallet "said yes" treated as settled with no preimage. Violates AGENTS §45. | No type-level distinction between ack and proof. | `wallet_acked` is a distinct phase from `settled`. Reaching `settled` requires a `PaymentProof` of `preimage` or `zap_receipt`; `wallet_ack` alone routes to `awaiting_receipt`, never directly to `settled` (unless maintainer opts in per AGENTS §45–47). |
| 4 | **Re-entry after failure.** `hasCompletedRef` guards success but a failed NWC path resets `isPaymentInProgress=false` (line 401) without marking terminal, so a subsequent WebLN click starts a fresh attempt on the same invoice. | Failure doesn't pin a terminal phase. | `failed` is terminal. Reducer rejects `attempting` from `failed`. Recovery requires an explicit `reset` action that clears invoice + proof. |
| 5 | **Manual-verify blind spot.** The `manualPreimage` flow (line 118) has no dedicated flag — none of the 3 booleans reflect "awaiting manual confirmation", so UI gating depends on side checks. | Manual path bypasses the boolean model. | `attempting` with `method: 'manual'` covers it. Submission of a preimage dispatches `settled` or `failed`; the button is gated on `phase.kind === 'invoice_ready'`. |
| 6 | **Expired invoice reuse.** No expiry handling in the booleans — an expired bolt11 can still drive an `attempting` click because nothing flags expiry. | Expiry isn't a state. | `expired` is terminal. An invoice-expiry timer dispatches it; `attempting` from `expired` is rejected. |

## Enforcement

**Lint rule (preferred).** Add a project ESLint rule (or `eslint-plugin-local`) targeting `src/components/lightning/`, `src/feature/wallet/`, and `src/lib/stores/` that flags `useState<boolean>` variables matching `/^is(Paying|Processing|Pending|Checking|Generating)/` when the file also imports from `@/lib/payments/*`. The rule suggests `usePaymentPhaseReducer`. This catches the 198 existing matches surfaced by the audit without a blanket boolean ban.

**Code review checklist (fallback).** When a lint rule is infeasible:
- [ ] Does the component hold a single `PaymentPhase`, not parallel booleans?
- [ ] Are all terminal states (`failed`, `expired`, `fulfilled`) unreachable for further transitions?
- [ ] Is `wallet_ack` ever equated with `settled` without explicit opt-in (AGENTS §45)?
- [ ] Does every wallet call site dispatch through the reducer, not set state directly?
- [ ] Is the pay button `disabled` for every phase except `invoice_ready`?

## Migration note

`LightningPaymentProcessor.tsx` (869 lines) and `DepositLightningModal.tsx`
are the two components with the most boolean churn. An audit found **198
matches** for the banned boolean pattern (`isPaying`, `isProcessing`,
`isPending`, `isChecking`, `isGenerating`) across `src/` in files that import
from `@/lib/payments/*`. Refactor is incremental: introduce the reducer
alongside the booleans, drive one method path (NWC) through it, verify tests,
then remove booleans. No API surface change — `PaymentProof` and
`paymentProofToReceiptPreimage` stay as-is.
