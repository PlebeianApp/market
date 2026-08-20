# ADR-0009: Auction Beta Exclusivity via the Existing Blacklist

## Status

Accepted

## Date

2026-08-20

## Context

The auctions feature enters an **exclusive beta phase** before opening to all
artists. During this phase, only the designated beta seller (chiefmonkey,
`npub1a3um269aaf3u5cy37kuykrrrnsg2pyv7za06pxjduv25lq5sdujs2qmdj6`, hex
`ec79b568bdea63ca6091f5b84b0c639c10a0919e175fa09a4de3154f82906f25`) should
have auctions resolvable in Plebeian Market.

Two goals drive this:

1. **Marketing** — chiefmonkey commands high prices in auctions; keeping
   his results as the visible benchmark reassures artists that they can
   expect high prices when auctioning on Plebeian Market.
2. **Dogfooding** — chiefmonkey catches bugs before auctions go live for
   all artists.

PR #1240 proposed a server-side, env-var-driven publish whitelist
(`AuctionWhitelistManager`, `AUCTION_WHITELIST_MODE` /
`AUCTION_WHITELIST_PUBKEYS`). The team decided to park those proposals in
the fork backlog and instead use the existing moderation blacklist,
because the code for it is already in production.

## Decision

Use the **existing NIP-51-style blacklist** as the sole auction resolution
gate during the exclusive beta. **No new gating code is required.**

The mechanism is already live:

- The blacklist is a mute-list event signed by the app key
  (`src/lib/schemas/blacklist.ts`, `src/server/BlacklistManager.ts`),
  managed by owner/admin/editor via the dashboard
  (`/dashboard/app-settings/blacklists`, `src/hooks/useEntityPermissions.ts`)
  and applied reactively without server restarts
  (`src/server/EventHandler.ts` processes blacklist updates as they arrive).
- `filterBlacklistedEvents` (`src/lib/utils/blacklistFilters.ts`) applies
  the pubkey check to **every** event kind, not just products and
  collections.
- Every auction fetcher in `src/queries/auctions.tsx` wraps its results
  with that filter: auction feeds, **single-auction resolution**
  (`fetchAuction`, `fetchAuctionByATag` — used by auction detail routes and
  naddr links), bids, settlements, path releases, and verdicts.

### Why the blacklist over the env-var whitelist

- **Zero new code** — already in production and battle-tested for spam.
- **Gates the read side, not just the publish path** — a blacklisted
  publisher's auctions stop resolving regardless of how they were
  published: our app, third-party Nostr clients, or direct relay writes.
  The #1240 whitelist only gated our own publish flow.
- **Runtime-editable with an audit trail** — changes are signed events;
  env vars require a server restart and leave no audit trail.
- **Go-live is cheap** — opening auctions to all artists is simply
  "stop blacklisting auction publishers".

## Operational Invariants

1. **Never blacklist the designated beta seller** (pubkey above). An admin
   should verify this pubkey is absent from the live blacklist before
   demos and launches.
2. Any other publisher observed running auctions that resolve in Plebeian
   Market during the exclusive beta is **blacklisted reactively** by an
   admin via the dashboard. No deploy is needed; the change applies as the
   signed blacklist event propagates.
3. **Opening auctions to all artists** = stop blacklisting publishers for
   exclusivity (and un-blacklist anyone blacklisted solely for this
   purpose, restoring their products, shop, and community presence).

## Consequences

**Positive:**

- The exclusivity requirement is met with production code today; nothing
  blocks the auction demo.
- Moderation surface stays unified with existing spam handling.

**Negative / trade-offs accepted:**

- **Whole-pubkey scope** — blacklisting hides the publisher's entire
  presence in Plebeian Market (products, shop, community), not just their
  auctions. Accepted for the exclusive beta at current volumes.
- **Display-only** — events remain on relays and in other clients; this is
  a resolution gate in Plebeian Market, not prevention. Adequate for the
  marketing goal.
- **Process dependency** — requires an admin to watch for new auction
  publishers during the beta. Accepted at pre-launch volume.

## Roadmap

1. **Near term** — add an e2e regression test asserting that a blacklisted
   publisher's auction returns `null` from `fetchAuction` /
   `fetchAuctionByATag`, locking in the resolution gate.
2. **If whole-pubkey hiding proves too blunt** — introduce auction-scoped
   blacklist entries (kind-specific coordinates, mirroring the existing
   product/collection coordinate entries).
3. **Medium term** — migrate moderation policy into ContextVM as a policy
   service, reusing the blacklist as a source.
4. **Optional, post-beta** — a Nostr admin-list whitelist (kind 30000,
   `d`-tag `auction_whitelist`) as sketched in the parked proposal
   `auction-whitelist-source.md` (fork backlog), for proactive publish
   control if the reactive model no longer scales.

## Related

- Parked proposals (fork backlog, `docs/adr/proposals/` on
  `felixfelix-bot/market` master): `auction-beta-tag.md`,
  `auction-whitelist-source.md`, `auction-v4v-splits.md`,
  `whitelist-open-mode.md` — provenance PR #1240.
- Blacklist implementation: `src/server/BlacklistManager.ts`,
  `src/lib/utils/blacklistFilters.ts`, `src/queries/auctions.tsx`,
  `src/routes/_dashboard-layout/dashboard/app-settings/blacklists/`.
- ADR-0005 (test isolation) is unaffected: the blacklist is loaded from
  the local relay in tests like any other app event.
