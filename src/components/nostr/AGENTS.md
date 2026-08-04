# AGENTS.md — src/components/nostr

This directory follows `src/components/AGENTS.md` and the repository-level
`AGENTS.md`.

## Purpose

`nostr/` contains Nostr-domain presentational components: user cards, product
cards, profile badges, NIP-05 indicators, WoT scores, post views, and other
components that render Nostr event/profile data.

## Import rules

- **May import from:** `@/components/ui/*`, `@/components/ui-wrappers/*`,
  `@/components/shared/*`, `@/lib/*`, `@/hooks/*`, `@/queries/*`,
  `@/stores/*` (read-only store hooks for display state).
- **May NOT import from:** `layout/`, `dialogs/`, or feature directories
  (`checkout/`, `orders/`, `wallet/`, etc.).
- **Canonical alias:** `@/components/nostr/{component}`.

## Nostr hooks exception

`nostr/` is the **only** component subdirectory permitted to call Nostr data
hooks inline. This is an explicit exception to the "no business logic in
presentational components" rule, documented here per ADR §1b.

### Allowed hooks

- `useProfile` — fetch profile data for a pubkey
- `useQuery` with nostr query options — fetch Nostr events (products,
  auctions, posts, etc.)
- Read-only store access for display state (e.g., `useStore(authStore)` for
  authenticated-user context)

### NOT allowed

- Cart actions (`cartActions`) — these are checkout-domain; pass via callbacks
- UI actions (`uiActions.openDialog`, etc.) — pass via callbacks
- Auth actions (`authActions.logout`, etc.) — pass via callbacks
- Wallet actions — pass via callbacks
- Publish/sign logic — belongs in `src/publish/`, not components

When a component needs to trigger an action, accept a **callback prop**
(e.g., `onAddToCart`, `onPress`, `onShare`) rather than calling the store
action inline. Data hooks for _reading_ Nostr state are the exception;
_mutating_ state is not.

## Standards

- **`forwardRef`:** All components **must** use `forwardRef`.
- **`cn()` className merging:** Accept `className` prop, merge via `cn()`.
- **Callbacks for actions:** Accept callback props for any user action
  (clicks, selections, etc.). Data-fetching hooks are the only exception.
- **Props typing:** Extend `React.HTMLAttributes<HTMLElement>` or
  `React.ComponentProps<typeof Wrapper>` as appropriate. Prefer accepting
  `pubkey` or `profile` as a prop rather than fetching internally when the
  parent already has the data.

## Review checklist

- [ ] Uses `forwardRef` with `displayName` set
- [ ] Uses `cn()` for className merging
- [ ] Only data hooks (useProfile, useQuery) — no action/store mutations
- [ ] Actions delegated via callback props
- [ ] No hardcoded colors — uses semantic tokens
