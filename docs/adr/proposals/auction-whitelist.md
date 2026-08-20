# Proposal: Auction Publish Whitelist

## Status

**Proposed** — implemented on the `auctions` lineage; seeking acceptance as the record of the decision.

**Date:** 2026-08-14

## Context

While auctions are in roll-out, the marketplace server must control WHO may
publish kind-30408 auction events through it. Two questions had to be answered
together, because they share one configuration surface:

1. **Source of truth** — where does the allow-list of auction publishers live?
   Candidates were: a Nostr list event (like the admin/editor role lists), the
   app database, or server environment variables.
2. **Default posture** — what happens when no allow-list is configured at all:
   open (anyone may publish auctions) or closed (nobody except admins)?

The mechanism is intentionally server-side and coarse: it gates publishing of
one kind through this app's relay during roll-out. It is not per-auction
moderation, and it does not replace the app-wide blacklist.

## Decision

1. **Source of truth: environment variables**, read once at server start:
   - `AUCTION_WHITELIST_MODE` — `'open'` (default) or `'whitelist'`.
   - `AUCTION_WHITELIST_PUBKEYS` — comma-separated hex pubkeys.

   Rationale over the alternatives: the roll-out list is small and
   operator-controlled; env vars need no extra Nostr events, no bootstrap
   ordering concerns and no database reads on the hot path. When the program
   matures, migrating to a Nostr list event (admin-managed, like other role
   lists) is the natural next step and can be its own ADR.

2. **Normalization rules** (single source of truth:
   `getAuctionWhitelistConfig()` in `src/server/runtime.ts`):
   - Any `AUCTION_WHITELIST_MODE` value other than the exact string
     `'whitelist'` — including unset, misspelled or whitespace-padded values —
     degrades to `'open'`. Fail-open is chosen deliberately: a typo in an env
     var must not silently brick auction publishing for every merchant.
   - `AUCTION_WHITELIST_PUBKEYS` entries are trimmed; empty entries are
     dropped. In `'open'` mode the pubkey list is ignored entirely.

3. **Default posture: open.** With no env vars set the server accepts
   kind-30408 from any publisher. Rationale: Plebeian's censorship-resistant
   posture is that publishing is permissionless by default; the whitelist is
   an operator opt-in for restricted roll-outs, not a gate everyone must
   configure. Note this gate is weaker than it sounds as a control: anyone can
   always publish auctions to any OTHER relay, so the whitelist protects only
   this app's first-party discovery surface during roll-out.

4. **Validation order and scope** (`EventValidator.validateAuctionEvent`):
   - The app-wide blacklist (kind-10000 list) is checked FIRST; a blacklisted
     pubkey may not publish auctions regardless of mode or whitelist
     membership.
   - Then the whitelist check applies in `'whitelist'` mode.
   - The general (admin-only) validator is deliberately NOT applied to
     kind-30408 — auctions are a merchant feature, and routing them through
     admin-only validation would make `'open'` mode meaningless.

5. **Observability:** the `/api/config` endpoint reports the _effective_
   config — `auctionWhitelist: { mode, pubkeyCount }` — read from the same
   normalized value validation enforces, so operators can verify what the
   server is actually enforcing (not just what the raw env contains).

## Consequences

- Positive: one normalization point shared by validator, event handler and
  `/api/config`; no drift between what is enforced and what is reported.
- Positive: fail-open default keeps auction publishing available through
  operator error; restricted mode is an explicit opt-in.
- Negative: env vars require a server restart to change the publisher set, and
  are not auditable on-chain.
- Negative: open default means the feature provides no protection until an
  operator actively enables `'whitelist'` mode.
- Security note: the blacklist check closes the loophole where a blacklisted
  publisher could otherwise reach the auction kind even in `'open'` mode.

## Implementation

- Config: `getAuctionWhitelistConfig()` (`src/server/runtime.ts`);
  `AuctionWhitelistConfig` (`src/server/types.ts`).
- Enforcement: `AuctionWhitelistManager` + `EventValidator.validateAuctionEvent`
  (`src/server/`), blacklist passed from `EventHandler`.
- Reporting: `/api/config` route (`src/server/http/config.ts`).
- Coverage: unit tests in `src/lib/__tests__/auction-whitelist-validation.test.ts`
  (modes, normalization, blacklist precedence); e2e default-open behavior in
  `e2e/tests/auction-whitelist.spec.ts`.
