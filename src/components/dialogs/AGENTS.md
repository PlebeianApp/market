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
  `@/queries/*`, `@/stores/*`, `@/publish/*`.
- **May NOT import from:** `layout/` or feature directories (`checkout/`,
  `orders/`, `wallet/`, etc.) unless the dialog is feature-specific (e.g.,
  a checkout dialog may live in `checkout/` instead).
- **Canonical alias:** `@/components/dialogs/{component}`.

## Standards

- **`forwardRef`:** Dialog composition components **must** use `forwardRef`
  when they render a root DOM element. If the component renders a Shadcn
  `Dialog` primitive as root (which manages its own portal), `forwardRef` is
  not required for the dialog root but should be used for inner content
  components.
- **`cn()` className merging:** Accept `className` prop where applicable,
  merge via `cn()`. Do not hardcode `bg-white` on `DialogContent` — use
  `bg-background` or a wrapper that standardizes surface colors.
- **Action via stores exception:** Dialogs may call store actions (e.g.,
  `uiActions.openDialog`, `uiActions.closeDialog`) and navigate as part of
  their interaction handling. This is the documented exception per ADR §1b.
- **No publish/sign logic inline:** Nostr publishing, signing, and timeout
  logic belongs in `src/publish/`, not in dialog components. Call
  `src/publish/` helpers via callbacks or imported functions — do not
  reimplement `Promise.race` sign/publish timeout patterns in dialogs.

## Review checklist

- [ ] No `bg-white` hardcoded on `DialogContent` — uses `bg-background` or wrapper
- [ ] No inline publish/sign/timeout logic — delegates to `src/publish/`
- [ ] Uses `cn()` for className merging
- [ ] Store actions are limited to UI/navigation (not domain mutations)
