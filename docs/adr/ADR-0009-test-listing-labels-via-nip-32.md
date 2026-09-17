# ADR-0009: Test-Listing Curation via NIP-32 Labels

## Status

Accepted (rev 5 — browsing-only gating + inspectability toggle + the discovery/curation surface taxonomy; products on `master`, auctions on `auctions` — both implemented)

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
  app authorizes. The authorized set is the app's **editors union its
  admins** (plus the app owner): editors are the day-to-day curation role
  and admins are curated content authorities, so both may curate. A
  dedicated moderator role or an automated labeler can be enrolled later
  without protocol change.
- **Scope: products and auctions only.** Labels attach to item coordinates,
  never to users. A valid, active user may post test items; the user's
  presence (shop, products, community) is unaffected while the item is
  curated. Whole-pubkey hiding remains the job of the existing spam
  blacklist and is explicitly out of scope here.
- **Browsing-only gating** — a test label hides an item from browsing and
  discovery surfaces only (home feed, paginated browse, search, collections,
  auction feed). The item remains reachable via direct link, the seller's
  profile, and the owner's dashboard.
- **Discovery vs curation surfaces (rev 4)** — filtering is a property of
  _organic discovery_ surfaces, not of every surface that happens to render an
  item. A **discovery surface** answers "what is for sale?" using selection
  criteria the viewer did not choose: home feed, paginated browse, NIP-50
  search _including its seller-name expansion_, collections, and the auction
  feed. A **curation surface** shows what a human explicitly chose: the
  app-configured Featured sections (products, collections, users) and, later,
  CMS-authored pages and blocks. Curation surfaces are **ungated by default** —
  the curator sees exactly what they picked. Opting a curation block into
  filtering is a per-block configuration decision reserved for the CMS work,
  never an ambient default. The label mechanism itself remains available on
  every surface; what this taxonomy fixes is the _default_, so a stale or
  accidental label can never silently empty a surface an operator believes they
  control.

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
4. **A discovery surface that composes an ungated read re-applies the gate on
   its own result set.** The gate belongs to the _surface_, not to the read
   path it borrows. Search is the worked example: its seller-name expansion
   fetches each matching seller's catalogue through the by-pubkey read (which
   must stay ungated, per step 3), so search gates the merged result set —
   otherwise a labeled item whose seller name matches would still surface and
   the promise made to the viewer and to the labeler ("hidden from browsing,
   search and collections") would be false for that path.
5. **Curation surfaces are ungated, by decision — not by omission.** The
   app-configured Featured sections resolve items through the by-a-tag detail
   read, so a labeled item an operator has featured stays visible in the
   carousel. This is the rev 4 taxonomy default: a curated surface shows what
   it was told to show, and the operator is not overridden by an ambient
   filter. Recording it here is the point — the gap is a documented decision
   rather than a fix waiting to be noticed. Whether a CMS block can opt _into_
   filtering is deferred to a follow-up proposal covering the taxonomy's
   naming, per-surface defaults, and block-level configuration.
6. Un-labeling is a NIP-09 deletion event (kind 5) signed by the same
   labeler, referencing the original label event's `id` in an `e` tag with
   a `k`-tag of `1985`. Clients MUST validate that the deletion event's
   pubkey matches the label event's pubkey before treating the label as
   deleted. The query layer treats a deleted label as absent — the item
   reappears without further action.
7. The label check runs only on browsing/discovery read paths, so a freshly
   un-labeled item reappears in those feeds without further action (it was
   never hidden from direct-link, profile, or dashboard views).

### UI

Dashboard / moderation actions for authorized labelers (editors ∪ admins):

- **Mark as "Test" Product** — publishes the kind 1985 label event.
  Reachable from the product's own dashboard edit page and, so a labeler can
  curate a listing they do not own, from the product's public page via the
  entity actions menu. The `.content` is pre-filled with a contact reference
  (the labeler's npub or a shared moderation nip05) so the item author can
  appeal.
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

Because gating is browsing-only, a labeled item stays visible on surfaces
where the viewer has no way to know it is curated — a direct link, the
seller's profile, the owner's dashboard. Every such surface therefore carries
a **user-facing notice** (`TestListingNotice`):

- **Detail page** — an amber "Test listing" pill beside the stock badge, next
  to the entity actions menu. Clicking it opens the explainer dialog.
- **Seller profile, owner dashboard, and toggle-revealed cards** — the same
  component in its compact icon-only variant (an eye-with-slash marker). On
  cards the marker must not trigger the surrounding link's navigation.
- **Explainer dialog** — states the exact effect (hidden from browsing and
  discovery, reachable by direct link) and gives an appeal path: the labeler's
  npub, falling back to the Plebeian team when the labeler is unknown.

**Copy invariant:** the mark/unmark confirmation dialogs MUST describe the
browsing-only effect. An earlier revision claimed the item was "excluded from
feeds and detail views", which is wrong — detail views are never gated — and
misled the labeler about what the action does.

### Auctions — surface map (implemented on the `auctions` branch)

The same taxonomy, resolved against the auction reads. The distinction that
matters in code is **where** the gate is applied, not only where it is skipped:

- **Gated (discovery):** the auction feed — `fetchAuctions` in
  `src/queries/auctions.tsx`. It runs blacklist → local deletes → the label
  check → version collapse, so every version of a labeled coordinate drops
  together and no older version can resurrect the auction in the feed.
- **Ungated, by decision:** `fetchAuction` (detail by id — the direct-link
  promise), `fetchAuctionByATag` (detail by a-tag), `fetchAuctionsByPubkey`
  (seller profile and owner dashboard). **The gate is never applied inside
  `fetchAuctionVersionEvents`**, the shared version-resolution helper all three
  of those reads go through: filtering there would collapse a labeled auction's
  version set to nothing and leave the item reachable only through the
  by-a-tag fallback path. Step 3 is a property of the read, not of a hopeful
  fallback. The Featured carousel (`auctionByATagQueryOptions`) inherits the
  same ungated read, which is the rev 4 curation default working as intended.
- **UI:** the `Show test listings` toggle sits beside the auction filters on
  the feed; the compact card marker renders top-left on `AuctionCard` (the
  top-right corner carries the LIVE/ENDED badge); the detail-page pill sits
  under the auction title row; and the mark/unmark action reaches the public
  auction page and the owner dashboard directly through `TestLabelButton` —
  auctions have no `EntityActionsMenu`, whose test-label arm is
  product-scoped, so the shared button _is_ the auctions equivalent of the
  product page's entity actions menu. The owner's dashboard detail carries the
  same notice as the product one.

Coverage: `src/queries/__tests__/auctionTestLabelGate.test.ts` (feed gated,
detail/by-a-tag/by-pubkey ungated, the shared version read issuing no label
query at all, toggle reveal, fail-open) and
`e2e/tests/test-labels-auctions.spec.ts` (feed exclusion, direct link + notice

- explainer, toggle reveal with card marker, NIP-09 reappearance, unauthorized
  label ignored, authorized labeler curating another seller's auction from its
  public page, owner dashboard keeping the item, non-authorized user seeing no
  actions).

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
- **Curated surfaces stay ungated (rev 4), so a labeled item an operator has
  featured remains visible in the Featured carousel.** Accepted deliberately
  over the alternative — a curated surface silently dropping an item a human
  explicitly chose, which would get worse once CMS page authors inherit an
  ambient filter they cannot see. The surface taxonomy and the CMS block-level
  opt-in are a follow-up proposal.

## Roadmap

1. Label schema + authorized-labeler list.
2. Query-layer `test`-label check beside the delete and blacklist checks
   (products on `master`; auctions on the `auctions` branch).
3. Dashboard actions: **Mark as "Test" Product** / **Unmark as "Test"
   Product** by coordinate, with pre-filled contact reference in `.content`.
4. e2e: a labeled item is excluded from browsing feeds but still reachable
   by direct link, seller profile, and dashboard; an un-labeled item
   reappears after the NIP-09 deletion event is processed.
5. "Show test listings" toggle (all users, default hidden) to reveal
   test-labeled items in browsing feeds.
6. Optional automation (e.g. an automated labeler key) for discretionary
   use during launch phases.
7. User-facing notice on labeled items (detail page, profile, dashboard,
   toggle-revealed cards) with an appeal contact.
8. **Discovery/curation surface taxonomy as a first-class concept** — rev 4
   records the default (discovery gated, curation unrestricted); a follow-up
   proposal covers the taxonomy's naming, per-surface defaults, and CMS
   block-level opt-in. Not a change in this PR.
9. Auctions: the same taxonomy applies to the auction feed (discovery) and to
   any curated auction surface, via the shared `testLabelFilters` layer.
   **Implemented** — see _Auctions — surface map_ above.

## Related

- Existing moderation (unchanged, spam-only, whole-pubkey):
  `src/server/BlacklistManager.ts`, `src/lib/utils/blacklistFilters.ts`.
- Current curation surface (ungated by the rev 4 default):
  `src/components/FeaturedSections.tsx` — resolves featured products through
  the by-a-tag detail read.
- Query-layer gate and its ADR-0009 tests:
  `src/lib/utils/testLabelFilters.ts`, `src/queries/testLabels.tsx`,
  `src/queries/products.tsx`.
- Rev 1 of this ADR (blacklist-based) lives in this branch's history.
- Parked proposals from #1240 in the fork backlog.
