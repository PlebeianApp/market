# ADR-0009: Test-Listing Curation via NIP-32 Labels

## Status

Accepted (rev 3 — browsing-only gating + inspectability toggle; products implemented in this PR, auctions compatibility layer in a follow-up PR)

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
  browsing and discovery surfaces are rendered.
- **Flexible** — applicable at our discretion, before, during, or after any
  launch phase, without schema changes.
- **Implementation-independent** — a Nostr-native signal any client or
  service can consume, not an application-internal flag.

## Decision

Use **NIP-32 labeling events** (kind 1985) to tag items as tests.

- Label event: kind 1985 with tags `["L", "com.plebeian.market"]`,
  `["l", "test", "com.plebeian.market"]`, and an `a`-tag holding the target
  item coordinate (product or auction). The `.content` field carries the
  reason and a **contact reference** — an npub or nip05 the labeled item's
  author can reach if they believe the label was applied in error.
- **Authorized labelers only** — labels count only when signed by keys the
  app authorizes (initially the existing admin set; a dedicated moderator
  role or an automated labeler can be enrolled later without protocol
  change).
- **Scope: products and auctions only.** Labels attach to item coordinates,
  never to users. A valid, active user may post test items; the user's
  presence (shop, products, community) is unaffected while the item is
  curated. Whole-pubkey hiding remains the job of the existing spam
  blacklist and is explicitly out of scope here.
- **Browsing-only gating** — a test label hides an item from browsing and
  discovery surfaces only (home feed, paginated browse, search, collections,
  auction feed). The item remains reachable via direct link, the seller's
  profile, and the owner's dashboard.

### Label event example

```json
{
	"kind": 1985,
	"pubkey": "<authorized-labeler-pubkey>",
	"created_at": 1724178700,
	"tags": [
		["L", "com.plebeian.market"],
		["l", "test", "com.plebeian.market"],
		["a", "30402:<merchant-pubkey>:<product-d-tag>"]
	],
	"content": "Marked as test listing. If this is a real product, contact npub1… or nip05:… to request removal."
}
```

The `a`-tag is the sole label target (per NIP-32, target tags represent the
object being labeled). No `p`-tag is included: a `p`-tag would label the
user, which this mechanism explicitly excludes — the merchant's pubkey is
already embedded in the `a`-tag coordinate.

For auctions the `a`-tag coordinate uses the auction kind instead
(e.g. `"<auction-kind>:<pubkey>:<auction-d-tag>"`).

### Un-labeling (deletion) event example

Un-labeling is a **NIP-09 deletion event** signed by the same labeler,
referencing the label event's `id` in an `e` tag:

```json
{
	"kind": 5,
	"pubkey": "<authorized-labeler-pubkey>",
	"created_at": 1724178900,
	"tags": [
		["e", "<label-event-id>"],
		["k", "1985"]
	],
	"content": "Unmarking test label — confirmed as a real product."
}
```

Per NIP-09, the `e`-tag references the specific label event by id, and the
`k`-tag declares the kind being deleted (`1985`). No `a`-tag is used: NIP-09
`a`-tags target replaceable/addressable events, and kind 1985 label events
are not replaceable (NIP-32 explicitly rejects a `d`-tag for this reason).
Clients MUST validate that the deletion event's pubkey matches the label
event's pubkey before treating the label as deleted. Once a valid deletion
is seen, the item reappears in browsing feeds without further action (it
was never hidden from direct-link, profile, or dashboard views).

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

1. When listing products/auctions on browsing and discovery read paths —
   home feed, paginated browse, search (NIP-50), collections, and the
   auction feed — after delete-status and blacklist filtering, check each
   item coordinate for an active `test` label.
2. Labels are fetched per coordinate (kind 1985 filtered by `#a`); feeds
   batch the check for the page's items.
3. Items carrying an authorized `test` label are excluded from browsing and
   discovery feeds only. Detail-by-id, detail-by-a-tag, and by-pubkey
   (seller profile / owner dashboard) read paths return the item regardless
   of label — the label never removes the item from direct navigation.
4. Un-labeling is a NIP-09 deletion event (kind 5) signed by the same
   labeler, referencing the original label event's `id` in an `e` tag with
   a `k`-tag of `1985`. Clients MUST validate that the deletion event's
   pubkey matches the label event's pubkey before treating the label as
   deleted. The query layer treats a deleted label as absent — the item
   reappears without further action.
5. The label check runs only on browsing/discovery read paths, so a freshly
   un-labeled item reappears in those feeds without further action (it was
   never hidden from direct-link, profile, or dashboard views).

### UI

Dashboard actions for authorized labelers on product and auction admin
pages:

- **Mark as "Test" Product** — publishes the kind 1985 label event.
  Visible only to authorized labelers (admin/moderator). The `.content`
  is pre-filled with a contact reference (the labeler's npub or a shared
  moderation nip05) so the item author can appeal.
- **Unmark as "Test" Product** — publishes the NIP-09 deletion event for
  the existing label. Visible only when an active `test` label is present
  on the item. Confirm dialog before publishing.

Both actions provide immediate UI feedback (optimistic state update),
then reconcile with the relay round-trip. Non-authorized users never see
these controls.

A **"Show test listings"** toggle is available to all users (admins and
regular users alike) on the browsing surface. It defaults to **hidden**
(labeled items are filtered out of browsing feeds); turning it on reveals
test-labeled items in those feeds. The toggle only affects
browsing/discovery read paths — direct links, seller profiles, and owner
dashboards always show the item.

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
3. Dashboard actions: **Mark as "Test" Product** / **Unmark as "Test"
   Product** by coordinate, with pre-filled contact reference in `.content`.
4. e2e: a labeled item is excluded from browsing feeds but still reachable
   by direct link, seller profile, and dashboard; an un-labeled item
   reappears after the NIP-09 deletion event is processed.
5. "Show test listings" toggle (all users, default hidden) to reveal
   test-labeled items in browsing feeds.
6. Optional automation (e.g. an automated labeler key) for discretionary
   use during launch phases.

## Related

- Existing moderation (unchanged, spam-only, whole-pubkey):
  `src/server/BlacklistManager.ts`, `src/lib/utils/blacklistFilters.ts`.
- Rev 1 of this ADR (blacklist-based) lives in this branch's history.
- Parked proposals from #1240 in the fork backlog.
