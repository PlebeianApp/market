# AGENTS.md — src/components/dialogs

This directory follows `src/components/AGENTS.md` and the repository-level
`AGENTS.md`.

## Purpose

`dialogs/` contains dialog compositions built on `ui/dialog` (and related
Shadcn primitives). These are modal/sheet UI compositions for specific actions:
share dialogs, NSFW confirmation, pickup location, zap, terms, etc.

## Import rules

- **May import from:** `@/components/ui/*`, `@/components/ui-wrappers/*`,
  `@/components/shared/*`, `@/components/nostr/*`, `@/lib/*`, `@/hooks/*`,
  `@/queries/*` (named adapter hooks only — see nostr/AGENTS.md for the
  allow-list pattern; generic `useQuery` with inline filters is not
  permitted).
- **May NOT import from:** `layout/`, `@/publish/*`, `@/stores/*` (for
  mutations — see below), or feature directories (`checkout/`, `orders/`,
  `wallet/`, etc.) unless the dialog is feature-specific (e.g., a checkout
  dialog may live in `checkout/` instead).
- **Store access:** Dialogs may call **UI-only store actions** —
  specifically `uiActions.openDialog` and `uiActions.closeDialog` — and
  navigation (e.g., `useNavigate`). This is the narrowly-scoped exception
  per ADR-0007 §1b. **Domain store mutations** are NOT permitted: no
  `cartActions`, no `walletActions`, no `authActions`, no order mutations.
  These must be passed via callback props (e.g., `onConfirm`, `onSubmit`).
- **Canonical alias:** `@/components/dialogs/{component}`.

## Standards

- **Ref exposure (React 19 ref-as-prop):** Dialog composition components
  **must** expose `ref` to their root DOM element when they render one.
  **Prefer React 19 ref-as-prop** (accept `ref` as a regular prop). **Use
  `forwardRef` only where a dependency still requires it.** If the component
  renders a Shadcn `Dialog` primitive as root (which manages its own portal),
  `ref` forwarding is not required for the dialog root but should be exposed
  for inner content components. Existing components using `forwardRef` do
  not need to be rewritten.
- **`cn()` className merging:** Accept `className` prop where applicable,
  merge via `cn()`. Do not hardcode `bg-white` on `DialogContent` — use
  `bg-background` or a wrapper that standardizes surface colors.
- **Store access — UI/navigation only:** See import rules above. Only
  `uiActions.openDialog`/`uiActions.closeDialog` and navigation are
  permitted. No domain store mutations (`cartActions`, `walletActions`,
  `authActions`, order mutations) — pass via callback props.
- **No publish/sign logic inline:** Nostr publishing, signing, and timeout
  logic belongs in `src/publish/`, not in dialog components. Dialogs must
  **not** import `src/publish/*` directly. If a Nostr action is needed,
  accept a **callback prop** (e.g., `onPublish`, `onSign`) that the parent
  route/feature wires to the publish layer. Do not reimplement
  `Promise.race` sign/publish timeout patterns in dialogs.

## Review checklist

- [ ] No `bg-white` hardcoded on `DialogContent` — uses `bg-background` or wrapper
- [ ] No inline publish/sign/timeout logic — delegates to `src/publish/`
- [ ] Uses `cn()` for className merging
- [ ] Store actions are limited to UI/navigation (not domain mutations)
