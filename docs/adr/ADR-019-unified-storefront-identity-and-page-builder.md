# ADR-019: Unified Storefront Identity and Page Builder

## Status

Proposed

## Date

2026-09-07

## Related

- ADR-016: zap/NDK external relay isolation (zap receipts arrive on `ZAP_RELAYS`)
- ADR-018: instance configuration and self-hosting boundary (domain, namespace,
  and `d` tags become instance-scoped; this ADR depends on that resolution)
- `docs/vanity-urls.md`, `docs/zap-purchase-manager.md`
- Current code: `src/server/ZapPurchaseManager.ts`, `src/server/VanityManager.ts`,
  `src/server/Nip05Manager.ts`, `src/lib/zapPurchase.ts`, `src/routes/$vanityName.tsx`

## Context

### The feature in Feynman terms

Today a user who wants to look "official" on this marketplace has to buy two
separate things that are really the same thing wearing two hats.

- A **NIP-05 address**: `alice@plebeian.market`. It is a name that, when a Nostr
  client looks it up, answers with a pubkey. Mechanically it is one line in a
  JSON file the server publishes at `/.well-known/nostr.json`.
- A **vanity URL**: `plebeian.market/alice`. It is a name that, when a browser
  visits it, resolves to a pubkey and renders that pubkey's profile page.

Both are "a short human name that points at my pubkey, rented for a period of
time, paid for with a Lightning zap." They are stored in two kind-30000
registries (`d=nip05-names`, `d=vanity-urls`), sold through two pricing tables
with identical numbers, bought through two dashboard pages, with two reserved
word lists that can disagree. Nothing stops `alice@plebeian.market` and
`plebeian.market/alice` from belonging to two different people, which is exactly
the kind of confusion an identity feature exists to prevent.

And when a visitor does land on `plebeian.market/alice`, they get the generic
profile page. The seller cannot say anything about who they are, feature a
product, or arrange the page. The name is a pointer to a template.

So the feature is: **buy one name, once. That name becomes your Nostr address,
your URL, and the address of a page you actually control the contents of.**

A useful analogy: today we sell a mailbox and a street number separately, and
the house behind them is a builder's show home nobody may redecorate. We want to
sell one address, and hand over the keys to the house.

### The wrong way to solve it

Several tempting shortcuts are wrong, and it is worth writing down why.

- **Wrong: keep two registries and "sync" them.** A background reconciliation
  between `nip05-names` and `vanity-urls` gives two sources of truth and a race.
  Two zap receipts arriving close together can leave `alice` NIP-05 with Bob and
  `alice` URL with Alice, and there is no principled way to decide which wins.
  Coupling must happen at purchase time, not after.
- **Wrong: make the page a rich text or HTML field.** Letting sellers store raw
  HTML and rendering it means storing attacker-controlled markup from an
  untrusted relay and injecting it into the DOM. That is OWASP A03 injection with
  extra steps, and no sanitizer survives contact with `dangerouslySetInnerHTML`
  in a wallet-bearing app. Same objection to a "just embed an iframe" escape
  hatch, and to allowing arbitrary remote `<script>`/CSS URLs.
- **Wrong: put page content in the app-signed registry event.** The registry is
  signed by the app key and rebuilt wholesale on every write. Putting user page
  content there makes the app the author of user speech, makes every page edit a
  server round trip, and makes one 30000 event grow without bound.
- **Wrong: build a general website builder.** Drag-and-drop layout, custom CSS,
  theming, and arbitrary nesting is a product in itself. It solves nobody's
  marketplace problem and cannot be validated with a schema.
- **Wrong: hardcode the domain.** The NIP-05 half only means something relative
  to a domain. Writing `plebeian.market` into the builder repeats the exact
  hardcoding ADR-018 exists to remove.

### The best way to solve it

Separate the two things that are genuinely different, and unify the two things
that are genuinely the same.

1. **The name is scarce, arbitrated, and paid for.** Exactly one registry, one
   zap label, one pricing table, one reserved list, one validity window. The app
   key remains the arbiter because only the app can witness payment. This is the
   part that must be centralised, and it is the only part.
2. **The page is not scarce and is not the app's business.** Page content is an
   addressable event signed by the _seller_, published to relays like any other
   user data. The app renders it; the app does not own it, gate it, or store it.
   A seller who stops paying loses the name, not the content — the page is still
   reachable by pubkey.
3. **The page is structured data, not markup.** A page is an ordered list of
   typed blocks validated by a Zod schema. The renderer switches on a closed set
   of block types and ignores anything it does not recognise. Text blocks accept
   a restricted markdown subset rendered through a component tree, never through
   raw HTML. This makes untrusted relay content safe by construction rather than
   by sanitiser vigilance, and it makes forward compatibility free.

That gives one purchase, one name, one URL, one address, and a page the seller
edits without the server being involved.

## Decision

### One purchased identity

Introduce a single `StorefrontIdentityManager` extending `ZapPurchaseManager`,
replacing `VanityManagerImpl` and `Nip05ManagerImpl` as the sale mechanism.

- Zap label: `storefront-register`. Registry tag: `name`.
- Registry: kind `30000`, `d=${instanceNamespace}-storefront-names`, resolved
  through ADR-018's instance config rather than a literal.
- One entry grants, for one validity window: the NIP-05 local part, the
  `/{name}` route, and the canonical page address for that name.
- Reserved names are the union of the two current lists. Validation additionally
  rejects any name currently held in either legacy registry by a different
  pubkey, for the whole compatibility window.
- Pricing collapses to one table (the two existing tables are already
  numerically identical), so the merge is not a price increase.

`/.well-known/nostr.json` is served from the unified registry, with legacy
`nip05-names` entries merged in read-only until they expire.

### Legacy compatibility

Both legacy managers stay registered as **read-only** resolvers for one release:
they answer lookups and keep serving existing holders until expiry, but they
reject new zap receipts. Renewal of a legacy entry mints a unified entry.
Resolution order is unified registry first, then legacy, so a unified entry
always wins. When the longest legacy validity window has elapsed, both classes
and their registries are deleted.

### Storefront page as user-signed addressable event

- Kind `30024` (addressable, application-specific), `d=storefront-page`,
  authored by the seller's pubkey. One page per pubkey initially.
- `content` is JSON: `{ version: 1, blocks: Block[] }`, validated by
  `StorefrontPageSchema` in `src/lib/schemas/storefront.ts`.
- Block types are a closed union: `hero`, `text`, `productGrid`,
  `collectionRow`, `linkList`, `contact`. Product and collection blocks carry
  `a`-style coordinates, never denormalised titles or prices — display data is
  re-fetched and re-validated at render time, per the repo rule that relay data
  is untrusted until validated.
- Unknown block types and blocks failing validation are dropped at render, not
  fatal. Parse failure of the whole document falls back to the profile page.
- No raw HTML, no remote scripts or stylesheets, no iframes, no arbitrary URLs
  in `src`/`href` beyond `https:` and in-app relative paths. Images resolve
  through the existing Blossom/NIP-96 host allowlist.

### One route, three layers of fallback

`src/routes/$vanityName.tsx` becomes the single resolution point:

1. Resolve `name` → pubkey via unified registry, then legacy vanity registry.
2. Fetch the seller's `30024` page event. If present and valid, render blocks.
3. Otherwise render the existing `ProfilePage` unchanged.

An unregistered or expired name keeps the current not-found treatment.

### Guardrails

- The domain shown in the builder and used for the NIP-05 identifier comes from
  runtime instance config (ADR-018), never a literal.
- The block renderer is covered by a unit test asserting that a hostile page
  event (script URLs, `javascript:` hrefs, unknown block types, oversized
  payloads) renders inert.
- An e2e path covers: purchase → name active → publish page → visit `/{name}` →
  blocks render → NIP-05 lookup returns the same pubkey.

## Requirements and steps

**Requirements**

- R1: One purchase grants NIP-05 identifier and vanity path for the same name
  and the same pubkey, with a single expiry.
- R2: The two names can never diverge to different pubkeys.
- R3: Existing holders of either legacy entry keep it until its expiry and can
  renew into the unified entry without losing the name.
- R4: Sellers can compose and publish a page from typed blocks without a server
  round trip and without a redeploy.
- R5: Page rendering is safe against hostile relay content by construction.
- R6: Losing the name never destroys page content.
- R7: No new hardcoded instance literals.

**Sequenced steps** (each independently reviewable)

1. Unified registry and manager, legacy managers demoted to read-only, unified
   `nostr.json`. No UI change. Behaviour-preserving for existing holders.
2. Client purchase helper, store, queries, and a merged dashboard page replacing
   the two current ones. Two nav entries become one.
3. Page schema, publish/fetch queries, block renderer, `$vanityName` wiring with
   profile fallback.
4. Builder UI.
5. Legacy removal, after the compatibility window, in a later release.

## Alternatives Considered

- **Bundle at the UI level only** — keep both registries and buy both in one
  click. Cheapest change, but R2 fails: two zaps, two receipts, two independent
  validations, and partial failure leaves a half-bought identity.
- **Make vanity a derived view of NIP-05** — no new registry; `/{name}` just
  reads `nip05-names`. Attractively small, and worth reconsidering if the
  builder is deferred. Rejected because the two reserved-word lists and
  validation rules differ (NIP-05 permits `.`, which is hostile in a path
  segment), so one of the namespaces would silently loosen.
- **Page content in kind 30023 (NIP-23 long-form)** — reuses an established
  kind, but 30023 content is markdown prose and cannot express product
  references without inventing an in-band syntax. Rejected.
- **Page content in the app settings / registry event** — rejected above: wrong
  author, unbounded growth, server in the edit path.
- **Third-party CMS or headless builder integration** — adds an external service
  dependency, breaks the decentralisation premise, and conflicts with ADR-0005's
  test isolation rule. Rejected.
- **Store pages server-side in SQLite** — reintroduces a central database into a
  project whose premise is that there is not one. Rejected.

## Files expected to change

Server:

- `src/server/StorefrontIdentityManager.ts` (new) — unified manager, reserved
  list, pricing, validation.
- `src/server/VanityManager.ts`, `src/server/Nip05Manager.ts` — demoted to
  read-only resolvers; reject new receipts.
- `src/server/EventHandler.ts` — register the new manager, keep legacy as
  resolvers, route `storefront-register` receipts.
- `src/server/http/nip05.ts` — serve `nostr.json` from unified + legacy merge.
- `src/server/index.ts` — exports.

Client — identity:

- `src/lib/zapPurchase.ts` — `purchaseStorefrontIdentity`; deprecate the two
  existing helpers.
- `src/lib/stores/storefront.ts` (new), superseding `src/lib/stores/vanity.ts`
  and `src/lib/stores/nip05.ts`.
- `src/queries/storefront.tsx` (new), superseding `src/queries/vanity.tsx` and
  `src/queries/nip05.tsx`; `src/queries/queryKeyFactory.ts`.
- `src/hooks/useStorefrontSync.ts` (new), superseding `useVanitySync.ts` and
  `useNip05Sync.ts`.
- `src/routes/_dashboard-layout/dashboard/account/storefront.tsx` (new),
  replacing `vanity-url.tsx` and `nostr-address.tsx`.
- `src/config/dashboardNavigation.ts` — two entries become one.

Client — page:

- `src/lib/schemas/storefront.ts` (new) — `StorefrontPageSchema`, block union.
- `src/publish/storefront-page.ts` (new) — sign and publish kind 30024.
- `src/components/storefront/` (new) — `StorefrontRenderer`, one component per
  block type.
- `src/components/storefront/builder/` (new) — builder shell, palette, canvas,
  inspector, preview.
- `src/routes/$vanityName.tsx` — resolve, fetch page, render or fall back.
- `src/routes/_dashboard-layout/dashboard/account/storefront-page.tsx` (new) —
  builder route.

Supporting:

- `e2e/tests/storefront-identity.spec.ts`, `e2e/po/` page object,
  `e2e/seed-relay.ts` fixtures.
- Unit tests for schema, renderer hostility cases, and manager validation.
- `docs/vanity-urls.md` rewritten; `docs/zap-purchase-manager.md` updated;
  `src/routes/AGENTS.md` and `src/AGENTS.md` touched where they describe the
  removed routes.

## UI component

**`StorefrontPage` (dashboard route)** — a two-card page replacing both existing
account pages.

- _Identity card._ One name field with a live-validated preview showing both
  derived forms simultaneously: `alice@{domain}` and `{domain}/alice`, the
  domain coming from runtime config. State machine: empty → invalid (format
  reason) → reserved → taken → available. Below it, the single pricing tier row;
  selecting one opens the existing `LightningPaymentProcessor` dialog unchanged.
  When an entry is already held, the card instead shows the active name, an
  expiry countdown with an "expiring soon" state, copy buttons for both forms,
  and a renew action. Expired entries appear as a reclaim affordance.
- _Page card._ Disabled with an explanatory state until a name is active. When
  active it shows a thumbnail of the current published page, last-published
  time, a "View live" link to `/{name}`, and "Edit page".

**`StorefrontBuilder` (builder route)** — a three-pane editor, single-column and
sheet-based on small screens.

- _Palette_ (left): the closed set of block types as buttons that append a block
  with sensible defaults. No drag-and-drop for the first version; reordering is
  explicit move-up/move-down plus keyboard equivalents, which is both accessible
  and far cheaper to build.
- _Canvas_ (centre): the blocks rendered by the same `StorefrontRenderer` used on
  the public page, wrapped in selection chrome. What the seller sees is
  literally the production renderer, so preview drift is impossible.
- _Inspector_ (right): a form for the selected block only, generated from that
  block's schema. Product and collection blocks use the existing product/
  collection pickers to insert coordinates rather than free-text IDs.
- _Header_: unsaved-changes indicator, Preview toggle, and Publish. Publish signs
  and publishes the 30024 event and reports relay acceptance; it is the only
  network write in the editor. Draft state lives in a TanStack Store slice with
  localStorage persistence so a refresh does not lose work.

## Consequences

- Two purchase flows, two stores, two query modules, two sync hooks, and two
  dashboard routes collapse into one each. Net deletion once the compatibility
  window closes.
- The divergence bug (`alice@` and `/alice` owned by different people) becomes
  unrepresentable.
- The app takes on a rendering responsibility for user-authored content, which
  is a real, permanent security surface. The closed block union and the absence
  of any raw-HTML path are what keep it bounded; that constraint must not be
  relaxed later for convenience.
- A compatibility window exists in which three registries are read. It is
  bounded by the longest legacy validity (365 days), which is a long time to
  carry dead code — an explicit removal issue must be filed with the first PR.
- Sellers gain a reason to renew: the page is theirs, but the short address is
  rented.
- This ADR depends on ADR-018 for the domain and namespace. Landing it before
  ADR-018 would add exactly the hardcoded literals ADR-018 removes.

## Open Questions

- Should one pubkey be allowed multiple names (aliases resolving to the same
  page), or is the one-name-per-pubkey constraint permanent? Aliases complicate
  the reverse lookup maps that both current managers maintain.
- Should the page be addressable per name (`d=storefront-page-alice`) rather than
  per pubkey, so that a seller who owns two names can publish two pages? Cheaper
  to decide now than to migrate later.
- Does an unregistered pubkey get a page at all — i.e. is the builder a paid
  feature or a free one rendered only at `/p/{npub}`? Making it free strengthens
  the "you never lose your content" property but weakens the purchase incentive.
- Merged pricing when a user currently holds one legacy entry and buys the
  unified one: prorate, extend, or ignore the overlap.
- Whether legacy `vanity-urls` and `nip05-names` `d` tags should be namespaced
  per ADR-018 during the window, or frozen as-is to avoid two migrations at once.
