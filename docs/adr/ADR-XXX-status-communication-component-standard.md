# ADR-XXX: Status Communication Component Standard

## Status

Proposed

## Date

2026-07-21

## Related

- `src/components/ui/alert.tsx` — existing Alert component (shadcn/ui primitive)
- `src/components/ui/badge.tsx` — existing Badge component with variant system
- `src/components/ui/sonner.tsx` — toast notification system (sonner)
- `styles/globals.css` — design token system (related ADR: Semantic Color Token Enforcement)
- AGENTS.md §"Constraints" — "Do not collapse payment lifecycles into booleans" (this ADR extends that discipline to how status states are communicated to users)

## Context

The codebase has three distinct mechanisms for communicating status to users, but components use them inconsistently or bypass them entirely:

### Existing mechanisms

1. **`Alert` component** (`src/components/ui/alert.tsx`) — shadcn primitive for inline status banners. Has `<Alert>`, `<AlertTitle>`, `<AlertDescription>`. Only **3 files** import it: `V4VManager.tsx`, `PIIExposureModal.tsx`, `BugReportModal.tsx`.

2. **`Badge` component** (`src/components/ui/badge.tsx`) — shadcn primitive with variant system (`default`, `secondary`, `destructive`, `outline`). Used **85 times** across components, but often for display rather than status. Status badges are frequently hand-rolled with raw `<div>` + color classes instead.

3. **Sonner toast** (`src/components/ui/sonner.tsx`) — ephemeral notifications for transient feedback. Used consistently for action results (copy, save, errors in catch blocks).

### Anti-patterns found

#### A. Hand-rolled alert/warning boxes (8+ instances)

The `border-l-4` alert box pattern is copy-pasted across at least 4 files with identical structure:

```tsx
// Identical structure repeated in CartContent, PIIExposureModal, ShippingAddressForm
<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
  <div className="flex">
    <div className="ml-3">
      <p className="text-sm text-yellow-700">{message}</p>
    </div>
  </div>
</div>
```

Variant with red:
```tsx
<div className="bg-red-50 border-l-4 border-red-400 p-4">
  <div className="flex">
    <div className="ml-3">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  </div>
</div>
```

Specific locations:
- `src/components/sheet-contents/cart/CartContent.tsx:63` — warning (missing shipping)
- `src/components/pii/PIIExposureModal.tsx:136` — warning
- `src/components/pii/PIIExposureModal.tsx:243` — error
- `src/components/checkout/ShippingAddressForm.tsx:422` — warning (no shipping method)
- `src/components/checkout/ShippingAddressForm.tsx:427` — warning (checking requirements)
- `src/components/checkout/ShippingAddressForm.tsx:432` — error (requirements failed)
- `src/components/checkout/ShippingAddressForm.tsx:437` — error (verification failed)
- `src/components/CartSummary.tsx:68` — similar pattern

#### B. Inconsistent error display (32 instances, 5+ variants)

`{error && ...}` pattern appears 32 times with at least 5 different implementations:

| Pattern | Files | Code |
|---|---|---|
| Minimal inline | `BunkerConnect.tsx:200`, `DecryptPasswordDialog.tsx:71`, `MigratePrivateKeyDialog.tsx:79` | `{error && <p className="text-sm text-red-500">{error}</p>}` |
| Centered | `Comments.tsx:226` | `{error && <p className="text-red-600 text-center py-4">Failed to load comments</p>}` |
| Block with wrapper | `ConversationView.tsx:98`, `OnChainPaymentProcessor.tsx:265`, `MigrationProgressDialog.tsx:128` | `{error && (<div className="...">...</div>)}` |
| Console only | Various | `} catch (e) { console.log(e) }` — error swallowed, no user feedback |

77 `catch` blocks exist in components — some show toasts, some set error state, some swallow silently.

#### C. Inconsistent loading indicators

`Loader2` from lucide-react is imported directly in 6+ files with varying class strings:
- `src/components/layout/Header.tsx:353` — `<Loader2 className="w-4 h-4 animate-spin" />`
- `src/components/ui/relay-manager/RelayManager.tsx:264` — `<Loader2 className="w-4 h-4 mr-2 animate-spin" />`
- `src/components/ui/sonner.tsx:25` — `<Loader2Icon className="size-4 animate-spin" />`
- `src/components/ui/image-uploader/ImageUploader.tsx:388` — custom div spinner (`border-2 border-primary border-t-transparent`)

251 loading-related lines across components. No shared `Spinner` or `LoadingState` component.

### Root cause

The `Alert` component exists but has no documented convention for when to use it. The Badge component has variants but no status-specific variants (success, warning, info). There is no shared `Spinner` component. Components are written ad-hoc, each author inventing their own status display markup.

## Decision

All inline status communication in components MUST use shared primitives. Three categories:

### 1. Status banners (persistent inline alerts)

Use `Alert` component from `src/components/ui/alert.tsx` for all persistent status messages (warnings, errors, informational notices that remain visible).

The `Alert` component must be extended with status variants:

```tsx
// Alert variants to add:
type AlertVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info'
```

| Variant | Use case | Replaces |
|---|---|---|
| `destructive` | Errors, failures, blocking issues | `bg-red-50 border-l-4 border-red-400` boxes |
| `warning` | Cautions, incomplete states, attention needed | `bg-yellow-50 border-l-4 border-yellow-400` boxes |
| `success` | Completed actions, positive confirmations | `bg-green-50 border-green-200` blocks |
| `info` | Neutral informational notices | `bg-blue-50 border-blue-200` blocks |
| `default` | General purpose (existing) | Existing usage |

**Prohibited**: Hand-rolled `border-l-4` status boxes. Any `<div>` that serves as a status banner must use the `Alert` component.

### 2. Status badges (compact status indicators)

Use `Badge` component from `src/components/ui/badge.tsx` for compact status indicators (order status, payment state, availability).

The `Badge` component's variant system must be extended with status-specific variants:

```tsx
// Badge variants to add:
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'
  | 'success' | 'warning' | 'info'
```

Each component that displays a status (order, payment, product availability) must map its domain status to a Badge variant via a **shared mapping function**, not an inline `getBadgeVariant` or conditional rendering.

### 3. Loading indicators

A shared `Spinner` component must be created in `src/components/ui/spinner.tsx`:

```tsx
interface SpinnerProps extends React.HTMLAttributes<HTMLElement> {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}
```

All loading spinners MUST use this component. Direct `Loader2` imports in component code outside `src/components/ui/` are prohibited.

### 4. Inline errors

A shared `InlineError` component must be created for the common `{error && <p>...</p>}` pattern:

```tsx
interface InlineErrorProps {
  error?: string | Error | null | false
  className?: string
}
```

This replaces the 32 `{error && ...}` patterns with consistent styling.

### 5. Toast notifications (transient feedback)

Sonner toasts remain the standard for transient feedback (action completed, copied, etc.). No change needed — this pattern is already consistent.

## Invariants

1. No hand-rolled `border-l-4` status boxes appear in component code. All persistent status banners use `<Alert variant="...">`.
2. No component defines its own `getBadgeVariant` or inline status→color mapping. Status badges use `<Badge variant="...">` with a shared mapping.
3. No direct `Loader2` / `Loader2Icon` imports in `src/components/` outside `src/components/ui/`. Loading indicators use `<Spinner>`.
4. No `{error && <p className="text-red-...">}` inline patterns. Use `<InlineError error={error} />`.
5. The Alert, Badge, and Spinner variants align with the semantic color tokens defined in the related ADR (Semantic Color Token Enforcement).

## Consequences

### Positive

- Consistent visual language — users see the same style for warnings everywhere.
- Single point of change — update the warning style in one place, not 8.
- Reduced duplication — eliminates ~40 hand-rolled status display instances.
- Clear contributor guidance — "use Alert for warnings" instead of guessing markup.
- Accessibility — shared components can include ARIA roles consistently (`role="alert"`, `aria-live`).

### Costs

- **Component changes needed**: Alert needs variant extension, Badge needs status variants, Spinner + InlineError need creation.
- **Migration effort**: ~40 instances to migrate across components. Incremental — one directory per PR.
- **Variant governance**: New Alert/Badge variants require a token in `globals.css` first (per the related color token ADR).

## Rollout / PR sequence

### PR 1 — Extend Alert + Badge variants, create Spinner + InlineError

- Add `success`, `warning`, `info` variants to `src/components/ui/alert.tsx` using semantic color tokens.
- Add `success`, `warning`, `info` variants to `src/components/ui/badge.tsx`.
- Create `src/components/ui/spinner.tsx`.
- Create `src/components/shared/InlineError.tsx`.

Files: `src/components/ui/alert.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/spinner.tsx`, `src/components/shared/InlineError.tsx`.

### PR 2 — Create shared status variant mappings

Create `src/lib/utils/statusVariants.ts` with mapping functions:

```ts
// Maps domain status strings to Badge/Alert variants
export function orderStatusToBadgeVariant(status: OrderStatus): BadgeVariant
export function paymentStatusToBadgeVariant(status: PaymentStatus): BadgeVariant
export function productAvailabilityToBadgeVariant(available: boolean): BadgeVariant
```

Files: `src/lib/utils/statusVariants.ts` + tests.

### PR 3+ — Migrate components incrementally

- PR 3: Replace `border-l-4` boxes with `<Alert>` in CartContent, PIIExposureModal, ShippingAddressForm.
- PR 4: Replace `{error && ...}` patterns with `<InlineError>` across auth components.
- PR 5: Replace `{error && ...}` patterns in remaining components.
- PR 6: Replace direct `Loader2` imports with `<Spinner>`.
- PR 7: Replace inline `getBadgeVariant` functions with shared mapping from `statusVariants.ts`.

## Notes

- This ADR depends on the Semantic Color Token Enforcement ADR — the Alert/Badge variants use semantic tokens (`--success`, `--warning`, `--info`) that must exist first.
- The `sonner.tsx` toast system is already consistent and out of scope for this ADR.
- `src/components/ui/progress.tsx` has a custom spinner (`border-t-transparent`) for progress bars — this is a different use case (determinate progress) and remains as-is.
- `getDistinctColorsForRecipients()` in `src/lib/utils.ts` generates dynamic colors for V4V recipient identification — this is intentional dynamic coloring, not status communication, and is exempt.
- The `{!isLoading && !error && data && data.length === 0}` empty-state pattern (found in Comments, ConversationView) is related but separate — empty states should eventually get a shared `EmptyState` component. This is a follow-up refactoring task, not part of this ADR.