# ADR-XXX: Status Communication Component Standard

## Status

Proposed

## Date

2026-07-21

## Related

- `src/components/ui/alert.tsx` — existing Alert component (Radix + cn, only 3 importers)
- `src/components/ui/badge.tsx` — Badge component with variant system
- `src/components/ui/skeleton.tsx` — Skeleton loading component
- `src/components/ui/sonner.tsx` — toast notification system
- AGENTS.md §Constraints — "Do not collapse payment lifecycles into booleans. Keep requested, attempted, wallet acknowledged, settled/proven, receipt published, merchant confirmed, expired, failed, refunded, and fulfilled states distinct."
- ADR-XXX: Semantic Color Token Enforcement — provides the color tokens this ADR relies on

## Context

The codebase has a shadcn/ui Alert component (`src/components/ui/alert.tsx`) with `default` and `destructive` variants. Only 3 files import it: `V4VManager.tsx`, `PIIExposureModal.tsx`, `BugReportModal.tsx`.

Meanwhile, the same visual pattern — a colored box with left border, icon, title, and message — is hand-rolled 8+ times across the codebase:

### Hand-Rolled Alert Boxes

| File                                                 | Line(s) | Pattern                                         |
| ---------------------------------------------------- | ------- | ----------------------------------------------- |
| `src/components/sheet-contents/cart/CartContent.tsx` | 63      | `bg-yellow-50 border-l-4 border-yellow-400 p-4` |
| `src/components/pii/PIIExposureModal.tsx`            | 136     | `bg-yellow-50 border-l-4 border-yellow-400 p-4` |
| `src/components/pii/PIIExposureModal.tsx`            | 243     | `bg-red-50 border-l-4 border-red-400 p-4`       |
| `src/components/checkout/ShippingAddressForm.tsx`    | 422     | `bg-yellow-50 border-l-4 border-yellow-400 p-4` |
| `src/components/checkout/ShippingAddressForm.tsx`    | 427     | `bg-yellow-50 border-l-4 border-yellow-400 p-4` |
| `src/components/checkout/ShippingAddressForm.tsx`    | 432     | `bg-red-50 border-l-4 border-red-400 p-4`       |
| `src/components/checkout/ShippingAddressForm.tsx`    | 437     | `bg-red-50 border-l-4 border-red-400 p-4`       |
| `src/components/CartSummary.tsx`                     | 68      | variant of same pattern                         |

All share identical internal structure:

```tsx
<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
	<div className="flex">
		<div className="ml-3">// title + message</div>
	</div>
</div>
```

This should be `<Alert variant="warning"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>`.

### Inconsistent Error Display

32 `{error && ...}` patterns across components, with 5+ variants:

| File                                                  | Line | Pattern                                                                               |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| `src/components/auth/BunkerConnect.tsx`               | 200  | `{error && <p className="text-sm text-red-500">{error}</p>}`                          |
| `src/components/auth/DecryptPasswordDialog.tsx`       | 71   | `{error && <p className="text-sm text-red-500">{error}</p>}`                          |
| `src/components/auth/MigratePrivateKeyDialog.tsx`     | 79   | `{error && <p className="text-sm text-red-500">{error}</p>}`                          |
| `src/components/Comments.tsx`                         | 226  | `{error && <p className="text-red-600 text-center py-4">Failed to load comments</p>}` |
| `src/components/messages/ConversationView.tsx`        | 98   | Full block with wrapping div                                                          |
| `src/components/checkout/OnChainPaymentProcessor.tsx` | 265  | Yet another structure                                                                 |

No shared `InlineError` component exists. The same concern (display an error message inline) is solved differently in every component.

### Inconsistent Loading Indicators

251 loading-related lines across components. `Loader2` from lucide-react is used directly with varying class strings:

| File                                                 | Line | Class                                                     |
| ---------------------------------------------------- | ---- | --------------------------------------------------------- |
| `src/components/layout/Header.tsx`                   | 353  | `Loader2 className="w-4 h-4 animate-spin"`                |
| `src/components/ui/relay-manager/RelayManager.tsx`   | 264  | `Loader2 className="w-4 h-4 mr-2 animate-spin"`           |
| `src/components/ui/sonner.tsx`                       | 25   | `Loader2Icon className="size-4 animate-spin"`             |
| `src/components/ui/image-uploader/ImageUploader.tsx` | 388  | Custom `border-2 border-primary border-t-transparent` div |

No shared `Spinner` component with size variants.

## Decision

**All status communication (warnings, errors, info, loading states) must use shared components.** Hand-rolled alert boxes, inline error paragraphs, and ad-hoc spinner markup are prohibited.

### 1. Extend the Alert Component

Add `warning` and `info` variants to `src/components/ui/alert.tsx`:

- `default` — neutral info (blue token)
- `destructive` — error (destructive token)
- `warning` — caution (warning token, depends on Semantic Color Token ADR)
- `success` — positive confirmation (success token)

All inline status notifications (warnings, errors, info) MUST use `<Alert variant="...">`.

### 2. Create `InlineError` Component

A shared `InlineError` component in `src/components/shared/InlineError.tsx`:

```tsx
<InlineError error={error} /> // renders nothing when error is falsy
```

Replaces all 32 `{error && <p className="text-sm text-red-500">{error}</p>}` patterns.

### 3. Create `Spinner` Component

A shared `Spinner` component in `src/components/ui/spinner.tsx`:

```tsx
<Spinner size="sm" />  // w-4 h-4
<Spinner size="md" />  // w-6 h-6
<Spinner className="mr-2" />  // custom classes merged
```

Replaces all ad-hoc `Loader2 className="w-4 h-4 animate-spin"` usage.

### 4. Create `LoadingState` Component

A shared `LoadingState` component for full-area loading displays:

```tsx
<LoadingState label="Loading orders..." />
```

Replaces the 3+ custom loading skeleton patterns in CartItem, ProfileName, FeaturedSections.

## Invariants

- `grep -rn 'border-l-4' src/components/` returns zero results (all alert boxes use the Alert component).
- `grep -rn '{error && <p' src/components/` returns zero results (all inline errors use InlineError).
- `grep -rn 'Loader2\|animate-spin' src/components/` returns zero results outside `src/components/ui/spinner.tsx` (all spinners use the Spinner component).
- The Alert component has at least 4 variants: default, destructive, warning, success.
- Status communication styling is consistent: the same state type renders identically everywhere.

## Consequences

### Positive

- One component to update when status styling changes.
- Consistent visual language for warnings, errors, loading — users learn one pattern.
- Less copy-paste markup in component files.
- Accessibility: Alert component handles ARIA roles; Spinner handles aria-busy.
- New contributors don't reinvent the alert box pattern.

### Costs

- Alert component needs 2 new variants (warning, success) — depends on Semantic Color Token ADR landing first.
- ~8 alert box sites need migration to Alert component.
- ~32 inline error sites need migration to InlineError.
- ~6 loading spinner sites need migration to Spinner.
- 3+ loading state patterns need migration to LoadingState.

## Rollout

### PR 1 — Extend Alert variants

Add `warning` and `success` variants to `src/components/ui/alert.tsx`. Depends on Semantic Color Token ADR Phase 0 (adding `--warning`, `--success` tokens).

### PR 2 — Create Spinner component

Create `src/components/ui/spinner.tsx` with size variants. Migrate all `Loader2` direct usage.

### PR 3 — Create InlineError + LoadingState

Create `src/components/shared/InlineError.tsx` and `src/components/shared/LoadingState.tsx`. Migrate the `{error && <p>}` pattern and custom loading patterns.

### PR 4 — Migrate alert boxes

Replace all `border-l-4` hand-rolled boxes with `<Alert variant="...">`. One file per commit.

### PR 5 — Lint enforcement

Add a script or ESLint rule that flags `border-l-4` and `{error && <p` patterns in `src/components/`.

## Notes

This ADR covers three related patterns that share the same root cause: missing shared components for status communication. While each could be addressed independently, treating them as one architectural decision ensures consistent treatment of status states across the UI.

The AGENTS.md constraint "do not collapse payment lifecycles into booleans" extends to visual presentation: a payment error must not be a red paragraph in one component and a bordered box in another. It must flow through a defined component that carries consistent visual semantics.

This ADR depends on ADR-XXX: Semantic Color Token Enforcement for the `--warning` and `--success` tokens needed by the Alert variants. If that ADR has not landed, Phase 0 of this ADR (extending Alert) is blocked.
