# ADR-0009: Test-Listing Curation via NIP-32 Labels

## Status

Proposed (rev 2 — supersedes the blacklist-based rev 1 in this branch's history)

## Date

2026-08-20

## Context

The marketplace has a persistent curation need: test items are posted as
products today and appear on the Plebeian Market front page alongside real
listings. This is expected — people continuously test tools and user
experience — but test items should not appear in official feeds.

The same need applies to auctions: as the feature rolls out, auctions that
are just beta tests will be posted while people familiarize themselves with
the new feature, and official auction feeds will be curated at our
discretion during the launch phase.

The mechanism should be:

- **Reusable** — one mechanism covering products and auctions, wherever
  official feeds or detail views are rendered.
- **Flexible** — applicable at our discretion, before, during, or after any
  launch phase, without schema changes.
- **Implementation-independent** — a Nostr-native signal any client or
  service can consume, not an application-internal flag.

## Decision

Use **NIP-32 labeling events** (kind 1985) to tag items as tests.

- Label event: kind 1985 with tags `["L", "com.plebeian.market"]`,
  `["l", "test", "com.plebeian.market"]`, and an `a`-tag holding the target
  item coordinate (product or auction). The reason goes in `.content`.
- **Authorized labelers only** — labels count only when signed by keys the
  app authorizes (initially the existing admin set; a dedicated moderator
  role or an automated labeler can be enrolled later without protocol
  change).
- **Scope: products and auctions only.** Labels attach to item coordinates,
  never to users. A valid, active user may post test items; the user's
  presence (shop, products, community) is unaffected while the item is
  curated. Whole-pubkey hiding remains the job of the existing spam
  blacklist and is explicitly out of scope here.

### Why NIP-32 labels, not NIP-51 blacklists

- **No static list maintenance** — labels are ordinary events, fetched on a
  per-product or per-auction basis. No client- or server-owned list to keep
  in sync, replace atomically, or rebuild on every change.
- **Per-item granularity** — a label targets exactly one item coordinate;
  removing it restores exactly that item. NIP-51 lists are coarse sets with
  replace-event semantics.
- **Auditable** — every label is a signed, timestamped event with an author
  and a reason.

## Implementation

The label check runs in the query layer **alongside the existing delete and
blacklist checks, before queries return data**:

1. When listing or resolving products/auctions, after delete-status and
   blacklist filtering, check each item coordinate for an active `test`
   label.
2. Labels are fetched per coordinate (kind 1985 filtered by `#a`); feeds
   batch the check for the page's items.
3. Items carrying an authorized `test` label are excluded from feeds and
   resolve to nothing in detail views — the same depth of gating as
   blacklisted items.
4. Un-labeling is a NIP-09 deletion event by the labeler; the item
   reappears without further action.

## Consequences

**Positive:**

- The front page shows real listings only — today and permanently.
- Auction beta curation is a discretionary use of the same mechanism: no
  schema change at launch or at go-live; opening up simply means labeling
  fewer things.
- Works regardless of how the item was published (our app, third-party
  clients, direct relay writes).
- No user is ever hidden by this mechanism.

**Negative / trade-offs accepted:**

- Net-new implementation: label schema, authorized-labeler check, and the
  query-layer filter (mirrors existing blacklist plumbing).
- One more check on read paths (batchable for feeds).
- NIP-32 currently has draft/optional status in the NIPs repo.

## Roadmap

1. Label schema + authorized-labeler list.
2. Query-layer `test`-label check beside the delete and blacklist checks
   (products on master; auctions on the `auctions` branch).
3. Dashboard actions: label / un-label an item by coordinate.
4. e2e: a labeled item is excluded from feeds and resolves to `null`.
5. Optional automation (e.g. an automated labeler key) for discretionary
   use during launch phases.

## Related

- Existing moderation (unchanged, spam-only, whole-pubkey):
  `src/server/BlacklistManager.ts`, `src/lib/utils/blacklistFilters.ts`.
- Rev 1 of this ADR (blacklist-based) lives in this branch's history.
- Parked proposals from #1240 in the fork backlog.
