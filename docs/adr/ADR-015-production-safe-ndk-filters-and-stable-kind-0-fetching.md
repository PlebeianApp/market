# ADR-015: Production-safe NDK filter handling and stable kind-0 profile fetching

## Status

Accepted

## Date

2026-08-02

## Related

- PR: #1207
- User-reported crash: `AI_GUARDRAILS ERROR: Filter[0].authors[0] is not a valid 64-char hex pubkey: ""`
- Symptom: profile pages fail to load / show a false "Could not load user profile" after the browser tab is backgrounded and refocused.
- Review feedback: #1206 (products empty-pubkey guard), maximotodev review of #1207.

## Context

Two failure modes produced the same user-visible outcome — a profile page
that wouldn't load — and two latent risks were surfaced in review.

1. **Filter-validation crash.** NDK AI Guardrails were enabled unconditionally
   in production via `{ skip: ... }`. The `filter-invalid-hex` guardrail is a
   fatal, `canDisable: false` throw, so any filter carrying an empty/invalid
   pubkey — e.g. `{ authors: [''] }` from a `pubkey ?? ''` fallback during a
   transient state — crashed the page. Several query helpers built
   `authors`/`#p` filters straight from a pubkey parameter with no empty
   check, so an empty string reached the filter.

2. **Profile clobber.** Kind-0 metadata is a stable, rarely-updated event,
   yet profile reads used React Query defaults (`refetchOnWindowFocus: true`).
   On a degraded relay pool after a backgrounded tab, a refetch could resolve
   to a null-shaped value and React Query committed `{ profile: null }` over
   previously-loaded data, tripping a false "Could not load user profile".
   Compounding this, `fetchProfileByIdentifier` wrapped every path in a
   try/catch that returned `{ profile: null, user: null }`, so timeout, relay
   error, no connection, and metadata not observed from the configured relays
   were all indistinguishable.

3. **App-config authority gap.** Not a reported crash, but a latent risk
   surfaced in review: the kind-31990 app-config fetch queried by author +
   kind + d tag yet trusted whichever returned event had the highest
   `created_at`. The content schema validates shape, not publisher authority,
   so a malformed `appPubkey` (or a relay returning an event from a different
   publisher) could yield app settings from an unrelated source.

4. **Products caller overwrite + nip19 render crash.** The
   `productsByPubkeyQueryOptions` factory guard (`enabled: isValidHexKey`)
   was correct, but consumers overwrote it with truthiness (`!!pubkey`),
   bypassing validation for malformed truthy input. `fetchProductsByPubkey`
   constructed `authors: [pubkey]` without a defensive check. And
   `FeaturedUserCard` called `nip19.npubEncode` synchronously during render —
   a malformed pubkey crashed the render before React Query evaluated
   `enabled`.

## Decision

### 1. Disable AI Guardrails in production; retain strict filter validation

- AI Guardrails are an NDK **dev-time educational tool** (shipped off by
  default). Gate them on `stage`: **on** in `development`/`staging`,
  **off** in `production`.
- **Retain NDK's default strict filter validation** (`'validate'`) in all
  stages. Do **not** set `filterValidationMode: 'fix'`: in `'fix'` mode NDK
  strips a bad `authors`/`#p` entry and, if that empties the array, drops the
  key entirely — broadening an identity-scoped request instead of rejecting
  it. That is fail-open and unsafe for marketplace identity, order, payment,
  and private-data boundaries. Invalid/empty pubkeys are rejected at the
  query layer **before** any filter is built (fail closed); strict validation
  then never throws because filters are always well-formed.
- The server-side app-settings fetch NDK uses `aiGuardrails: false` with
  default strict validation. App-config publisher authority is verified
  separately (see decision 4).

### 2. Validate identity inputs before building Nostr filters

Query helpers that build `authors`/`#p` from a pubkey parameter reject a
malformed pubkey (not just an empty one) before constructing the filter, using
the repository-standard checks:

- **Hex-pubkey fetchers** (`fetchAuthor`, `fetchProductsByPubkey`,
  `fetchUserPaymentDetails`, `fetchShippingOptionsByPubkey`,
  `fetchOrdersByBuyer`/`fetchOrdersBySeller`,
  `fetchSellerPrivateOrderGiftWraps`, `fetchCollectionsByPubkey`,
  `resolvePaymentDetailsForProduct`) use `isValidHexKey` — these build
  `authors`/`#p` directly, which NDK's strict validation requires to be 64-hex.
  `fetchAuthor` and `fetchProductsByPubkey` **throw** on invalid input because a
  malformed pubkey reaching the fetcher is a programming error, not a data
  condition — the throw surfaces the bug in React Query's error state rather
  than silently returning an empty list that conflates "no results" with
  "invalid input." The sibling fetchers (`fetchShippingOptionsByPubkey`,
  `fetchUserPaymentDetails`, etc.) return `[]` because their try-catch blocks
  swallow throws; they may be migrated to the throw pattern in a follow-up.
  `fetchProductPaymentDetails` guards its optional-author path: if a pubkey is
  provided but malformed, it returns `[]` (fail closed); if no pubkey is
  provided, it proceeds with a broad query (no `authors` filter) — that
  broadening is intentional.
- **Identifier-accepting** paths (`fetchProfileByIdentifier`, `useProfileName`,
  `useProfileNip05`, `useProfile`) use `validateProfileIdentifier`, because
  they feed `ndk.fetchUser`, which accepts hex/npub/nprofile/nip05. (The
  dashboard messages route passes an npub route param to `useProfileName`, so
  a hex-only gate would break that view.) The validation lives in the shared
  `profileByIdentifierQueryOptions` factory (`enabled`), not in individual
  hooks, so every consumer is gated — including route loaders and direct
  `useQuery` callers. Callers with additional conditions COMBINE (not
  overwrite) the factory's `enabled`, e.g.
  `enabled: options.enabled && !validationError`.
- **Hex-pubkey query factories** (`authorQueryOptions`,
  `productsByPubkeyQueryOptions`, `collectionsByPubkeyQueryOptions`,
  `shippingOptionsByPubkeyQueryOptions`, `wotScoreQueryOptions`) use
  `isValidHexKey` at the factory level, so `useProductsByPubkey`,
  `useCollectionsByPubkey`, `useShippingOptionsByPubkey`, `useWotScore`, and
  direct callers inherit the guard. Hooks that build queries inline
  (`useOrdersByBuyer`, `useOrdersBySeller`, `useUserPaymentDetails`,
  `useRichUserPaymentDetails`, `useWalletDetail`, `useAvailablePaymentOptions`)
  also use `isValidHexKey` at the `enabled` boundary.
  Consumers with additional conditions COMBINE (not overwrite) the factory's
  `enabled`, e.g. `enabled: productOptions.enabled && isAuthenticated`.
  Truthiness checks (`!!pubkey`) are dropped because `isValidHexKey` implies
  truthiness — only genuine business-logic conditions survive the
  combination.

This replaces the earlier truthiness (`!!pubkey`) guards, which permitted
whitespace, truncated keys, and arbitrary malformed non-empty values.

- **`safeNpubEncode`** (`lib/utils.ts`): wraps `nip19.npubEncode` with
  `isValidHexKey`, returning `null` for invalid input instead of throwing.
  Components like `FeaturedUserCard` call `nip19.npubEncode` synchronously
  during render — a malformed pubkey crashes the render before React Query
  evaluates `enabled`. The helper validates before encoding, preventing the
  crash. It is reusable for other render-time npub encoding call sites.

### 3. Distinguish transient fetch failures from metadata not observed; don't refetch stable kind-0

- `fetchProfileByIdentifier` throws on transient failures — timeout (8s
  `Promise.race`) and relay errors — so React Query treats them as `isError`
  and retains previous profile data. No zero-relay preflight check is
  performed: zero connected relays is a normal transient state during
  `connect()`, and the 8s timeout determines failure. If a relay connects
  during the window, the subscription proceeds naturally. Only metadata
  not observed from the configured relays (relays connected and
  `fetchProfile()` resolved to null) returns the null-shaped value.
- ProfilePage keeps previous data visible during refetch
  (`placeholderData: keepPreviousData`) and stops refetching kind-0 on
  window focus (`refetchOnWindowFocus: false`). `refetchOnReconnect` is
  **preserved** (React Query default `true`) so a failed zero-relay startup
  query auto-retries once the browser regains connectivity. Recovery uses
  normal React Query retries, browser-network reconnect handling, and a
  manual **Try again** button for retryable errors — not an NDK
  relay-readiness subscription.
- Three distinct error states: **transport error** (`isError && !profile`,
  retryable, shows "Try again"), **metadata not observed** (`!isError &&
!profile`, settled, non-retryable), and **invalid identifier** (non-retryable).
- Behavior is covered by `profilesFetch.test.ts`.

### 4. Verify app-settings publisher authority before accepting content

The kind-31990 app-config fetch (`fetchAppSettings` in `lib/appSettings.ts`)
queries `{ kinds: [31990], authors: [appPubkey], '#d': ['plebeian-market-handler'] }`.
Two hardenings close the gap between the requested filter and the content the
app actually trusts:

- **Validate before the query**: `appPubkey` is checked with `isValidHexKey`
  before an NDK instance is created or any relay request is issued. A malformed
  key is rejected early (fail closed) rather than relying solely on NDK's
  strict filter validation to refuse the filter.
- **Verify after the fetch**: the returned events are filtered to only those
  authored by `appPubkey`, with kind 31990 and the exact `d` tag
  `plebeian-market-handler` (`selectAuthoritativeAppSettingsEvent`). The
  content schema validates shape, not authority, so a spoofed event from a
  different publisher that happens to pass `AppSettingsSchema` is refused.
  A higher-timestamp spoofed event is ignored in favor of the legitimate one.
- Behavior is covered by `appSettings.test.ts`.

### Explicit non-goals

- **Do not** return a placeholder profile instead of the "Profile not found"
  error; profiles with no metadata observed from configured relays still show
  the error.
- **Do not** change fetching logic apart from: input validation guards, the
  transient/absence distinction, and app-config publisher-authority
  verification. No other fetching behavior is altered.

## Consequences

- A malformed pubkey (empty, whitespace, truncated, or non-hex) is rejected
  at the query layer with `isValidHexKey` / `validateProfileIdentifier`
  before any filter is built (fail closed). NDK strict validation is retained
  as the backstop, so any filter that slips past the guards fails loudly
  rather than being silently broadened.
- Guardrails off in production removes the `AI_GUARDRAILS` educational throw;
  strict `'validate'` remains the backstop for malformed filters.
- A transient post-refocus refetch no longer clobbers a loaded profile
  (throws → `isError` + retained data; `keepPreviousData` covers the pending
  state). Metadata not observed from the configured relays still surfaces the
  "not found" error; transport errors surface a retryable error with a
  "Try again" button.
- App-config content is accepted only from events authored by the expected
  `appPubkey` with kind 31990 and the exact d tag; a spoofed event that
  passes the shape schema is refused.
- New query helpers building `authors`/`#p` from a pubkey must validate it with
  `isValidHexKey` (hex fetchers) or `validateProfileIdentifier` (identifier
  fetchers) before constructing the filter. Factory-level `enabled` guards
  must be combined (not overwritten) by callers; truthiness is insufficient.
  `safeNpubEncode` should be used instead of bare `nip19.npubEncode` in
  render-time code paths.

## Follow-ups (not in this PR, per review)

- None. The products-by-pubkey guard from #1206 (`enabled: isValidHexKey`
  at the query-activation boundary) has been incorporated into this PR;
  #1206 is closed as superseded.
