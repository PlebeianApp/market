# AGENTS.md — src/components/nostr

This directory follows `src/components/AGENTS.md` and the repository-level
`AGENTS.md`.

## Purpose

`nostr/` contains Nostr-domain presentational components: user cards, product
cards, profile badges, NIP-05 indicators, WoT scores, post views, and other
components that render Nostr event/profile data.

## Import rules

- **May import from:** `@/components/ui/*`, `@/components/ui-wrappers/*`,
  `@/components/shared/*`, `@/lib/*`, `@/hooks/*`, `@/queries/*`
  (read-only data adapters only).
- **May NOT import from:** `layout/`, `dialogs/`, `@/publish/*`, `@/stores/*`
  (for mutations — read-only store selectors are permitted, see below), or
  feature directories (`checkout/`, `orders/`, `wallet/`, etc.).
- **Canonical alias:** `@/components/nostr/{component}`.

## Nostr data-access exception

`nostr/` is the **only** component subdirectory permitted to consume Nostr
data adapters inline for **read-only** data access. This is an explicit,
narrowly-scoped exception to the "no business logic in presentational
components" rule, documented here per ADR-0007 §1b.

### Allowed — named read-only data-adapter hooks from `@/queries/*`

Components may import and call the following **named** adapter hooks. These
encapsulate query-key construction, NDK filter logic, and relay-error
handling behind a stable, typed interface. Components consume the adapter's
return value — they do not access the raw NDK/relay layer or construct
queries themselves.

- `useProfile` — fetch full profile metadata for a pubkey (read-only)
- `useProfileName` — fetch display name for a pubkey (read-only)
- `useProfileNip05` — fetch NIP-05 verification status (read-only)
- `useProductTitle`, `useProductDescription`, `useProductPrice`,
  `useProductImages`, `useProductsByPubkey`, `useProductByATag`,
  `useProductIsNSFW` — product data adapters (read-only)
- `useWotScore` — web-of-trust score for a pubkey (read-only)
- `useFeaturedProducts`, `useFeaturedUsers` — featured content (read-only)
- Read-only store selectors for display state (e.g.,
  `useStore(authStore)` to check authenticated-user context)

**Generic `useQuery()` with raw inline Nostr filter options is NOT
permitted.** If a new data need arises, add a named adapter hook to
`@/queries/*` and consume it here. The allow-list above is illustrative, not
exhaustive — any named hook exported from `@/queries/*` that is read-only
and returns display data is acceptable.

### NOT allowed — mutations, actions, publishing

- Cart actions (`cartActions`) — checkout-domain; pass via callbacks
- UI actions (`uiActions.openDialog`, etc.) — pass via callbacks
- Auth actions (`authActions.logout`, etc.) — pass via callbacks
- Wallet actions — pass via callbacks
- **Publishing, signing, relay management** — belongs in `src/publish/`,
  not components. Components must not import from `src/publish/` directly;
  if a Nostr action is needed, the parent route/feature passes a callback.
- Raw NDK event construction or relay publishing — components consume
  validated adapter results, not raw protocol APIs.

When a component needs to trigger an action, accept a **callback prop**
(e.g., `onAddToCart`, `onPress`, `onShare`) rather than calling the store
action inline. Data hooks for _reading_ Nostr state are the narrow
exception; _mutating_ state, publishing, and signing are not.

## Standards

- **Ref exposure (React 19 ref-as-prop):** All components **must** expose
  `ref` to their root DOM element. **Prefer React 19 ref-as-prop** (accept
  `ref` as a regular prop). **Use `forwardRef` only where a dependency
  still requires it.** Existing components using `forwardRef` do not need
  to be rewritten.
- **`cn()` className merging:** Accept `className` prop, merge via `cn()`.
- **Callbacks for actions:** Accept callback props for any user action
  (clicks, selections, etc.). Data-fetching hooks are the only exception.
- **Props typing:** Extend `React.HTMLAttributes<HTMLElement>` or
  `React.ComponentProps<typeof Wrapper>` as appropriate. Prefer accepting
  `pubkey` or `profile` as a prop rather than fetching internally when the
  parent already has the data.

## Review checklist

- [ ] Exposes `ref` to root DOM element (React 19 ref-as-prop)
- [ ] Uses `cn()` for className merging
- [ ] Only named adapter hooks from @/queries/ — no generic useQuery, no action/store mutations
- [ ] Actions delegated via callback props
- [ ] No hardcoded colors — uses semantic tokens
