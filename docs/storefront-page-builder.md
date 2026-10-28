# Storefront Page Builder

A visual page builder in the dashboard that lets any user compose their own
public profile page from a fixed set of blocks, and publishes it as a Nostr
event they own.

Implements ADR-019 (page half) with the Puck editor named in ADR-0006. See
"Relationship to the ADRs" at the bottom for what was and was not taken from
each.

## What it does

`Dashboard → Account → 🎨 Profile Page` opens a three-pane editor. The author
drags blocks onto a canvas, edits their properties in a sidebar, switches the
page on, and presses Publish. From then on `/{vanityName}` and
`/profile/{identifier}` render that page instead of the standard profile view.

Nothing is gated. A user does not need to own a vanity name to build a page —
they lose the short URL when a name lapses, never the page, which stays
reachable at `/profile/{pubkey}`.

When a storefront has an active registered vanity name, opening it through
`/profile/{identifier}` redirects to `/{vanityName}` using history replacement.
Draft-preview parameters and URL fragments are preserved. Storefronts without
an active name keep the profile URL; ordinary profile fallbacks are not redirected.

Public storefronts and author draft previews render as standalone pages, without
the marketplace header, footer, or background pattern. Standard profile fallbacks
and other marketplace routes retain the normal layout. Authentication, payment
dialogs, and notifications remain available on standalone storefronts.

The builder's **View live page** link opens a separate browser tab, leaving the
editor open. Unsaved or unpublished pages use an author-only draft preview; after
publishing an enabled page, the link opens the public URL without the preview
parameter. Publishing does not navigate the editor tab away.

## Optional storefront subdomains

Path-based storefronts remain the default. To give registered names their own
hostname, set the environment-only `INSTANCE_STOREFRONT_BASE_URL` and restart
the app. This is the marketplace origin, not a wildcard or a seller's hostname.

For local development with the app listening on port 3000:

```dotenv
INSTANCE_STOREFRONT_BASE_URL=http://localhost:3000
```

The marketplace and editor stay at `http://localhost:3000`; a registered `farm`
storefront opens at `http://farm.localhost:3000/`, and its identity remains
`farm@localhost`. Browsers normally resolve `*.localhost` to loopback; if the
local resolver does not, add a local DNS wildcard or an explicit hosts entry
for each test name. Keep the configured port equal to the app's listening port.
This setting does not change where the server binds.

For a hosted deployment:

```dotenv
INSTANCE_STOREFRONT_BASE_URL=https://market.example.com
```

Configure DNS for both `market.example.com` and `*.market.example.com` to reach
the same deployment. Install a TLS certificate covering the base hostname and
wildcard. The reverse proxy must accept both, preserve the original Host, forward
WebSocket upgrades, and serve app routes/assets on seller hosts too. The app
does not provision DNS, certificates, or proxy configuration.

The existing active-name registry resolves `farm.market.example.com` to the
seller's published page; no additional identity purchase or event kind is
introduced. The NIP-05 address uses the configured base hostname
(`farm@market.example.com`), not the seller subdomain. Public profile and vanity
path links redirect to the canonical seller URL when an enabled storefront has
an active name, preserving query parameters and fragments. Unknown, reserved,
and expired names cannot render another seller's storefront. Only one direct
subdomain label is interpreted as a name.

Origins must use HTTPS, except HTTP on localhost. Credentials, non-root paths,
queries, fragments, and IP addresses are rejected at configuration parsing.
Legacy registrations that are not valid DNS labels retain a path on the
configured base origin.

Use the base origin for editing. Draft-preview links remain on the editor
origin and require the signed-in author; drafts are not sent to seller hosts.
Browser authentication, private keys, local drafts, wallets, and carts are not
automatically transferred between origins. Existing product, cart, and checkout
routes run on the origin where they are opened; this feature adds no shared
login or cross-origin cart handoff. Removing the setting restores path routing.

## CMS starter templates

The setup wizard offers four business-focused starters alongside Blank page,
Link in bio, Shop, and Showcase:

| Starter     | Intended business | Suggested theme | Layout                                                                                                        |
| ----------- | ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| Farmstand   | Farmer            | Forest          | Short welcome, six-item harvest grid, farm story, pickup and market details                                   |
| Studio      | Artist            | Mono            | Centred introduction, eight-work two-column gallery, studio story and commissions                             |
| Local Pro   | Electrician       | Default         | Short service introduction, enquiry links, six-service grid, service area, qualifications and booking process |
| Corner Shop | Retail store      | Sunset          | Compact welcome, twelve-item four-column catalogue, shop story, shipping and returns                          |

These are ordinary CMS blocks, not locked page types. Authors can change every
heading, image, link, section, theme, and grid in the builder. Catalogue blocks
read the author's actual listings; they do not create products, sort by sales,
or invent portfolio work. Grid columns collapse to one on small screens.

Farmstand uses a Shopify-inspired editorial layout: a compact profile-backed
store header with the existing cart drawer, editable same-page navigation, a split hero with a bundled original
farm illustration, a working "Shop the harvest" action, and borderless product
cards. The remaining starters put their main content before a non-full-screen
profile section. No stock imagery, sample contact destinations, testimonials, qualifications,
or featured-product references are prefilled. Replace the instructional text
with accurate business details before publishing. Add contact or directions
URLs to the empty link blocks; they appear as setup hints in the CMS and remain
hidden on the public page until configured. To add a hero action, set both its
button label and a valid destination. Farmstand's navigation targets the `harvest`,
`our-farm`, and `visit` section anchors. If an anchor is renamed or its block is
removed, update the corresponding links too.

These controls are also available independently in the CMS: **Typography** on
the page, **Header layout** and navigation links on Profile header, **Hero layout**
and eyebrow on Hero banner, **Product card style** on Product grid, and
**Section anchor** on Text and Product grid. Existing documents retain their
previous presentation unless these optional settings are selected. Product
links, stock checks, and add-to-cart actions still use the existing marketplace
implementation; no Shopify account, service, or checkout is introduced.

## The event

| Field     | Value                                                          |
| --------- | -------------------------------------------------------------- |
| kind      | `30024` (addressable)                                          |
| `d` tag   | `storefront-page` — one page per pubkey                        |
| `title`   | optional, mirrors the page title so other clients can list it  |
| author    | the user's own pubkey; the app key is never involved           |
| `content` | JSON `{ version, enabled, root: { props }, content: Block[] }` |

This is a new event kind for this repository. Per `AGENTS.md` ("No new event
kinds ... without code, tests, and documentation that make the decision
explicit"), the decision is: page content is **user speech**, so it is signed by
the user and published to relays like any other user data. It does not go in the
app-signed kind-30000 registry — that event is rebuilt wholesale on every write,
which would make the app the author of user speech and put a server round trip in
the edit path.

`enabled: false` keeps the document intact while restoring the default profile
view. Turning a page off is not a deletion: NIP-09 deletions are honoured
inconsistently by relays, and the author may want their blocks back.

Example:

```json
{
	"kind": 30024,
	"tags": [
		["d", "storefront-page"],
		["title", "Alice's workshop"]
	],
	"content": "{\"version\":1,\"enabled\":true,\"root\":{\"props\":{\"title\":\"Alice's workshop\",\"background\":\"default\"}},\"content\":[{\"type\":\"Hero\",\"props\":{\"id\":\"h1\",\"title\":\"Hand-thrown pottery\",\"align\":\"center\",\"minHeight\":360}},{\"type\":\"ProductGrid\",\"props\":{\"id\":\"g1\",\"source\":\"all\",\"limit\":12,\"columns\":3}}]}"
}
```

## Why structured blocks rather than markup

Page content arrives from a relay, so it is untrusted. The safe options were to
sanitise attacker-controlled HTML, or to not accept HTML at all. This app holds
wallet material — a successful injection here drains accounts rather than
defacing a page — so it does not accept HTML at all.

A page is an ordered list of **typed blocks** drawn from a closed union. The
renderer is an exhaustive `switch` over that union and can only emit components
the app already ships. There is no `dangerouslySetInnerHTML` anywhere on the
path from relay bytes to the DOM, no remote script or stylesheet, and no iframe.

Consequences that follow from the same design:

- **URLs are gated by scheme.** `href` and `src` accept only absolute `https:`
  URLs and in-app absolute paths. Links also accept named same-page fragments
  such as `#harvest`; image sources do not. Section anchors start with a letter
  and contain at most 80 letters, numbers, hyphens, or underscores.
  `javascript:`, `data:`, `blob:`, `file:`,
  plaintext `http:`, and protocol-relative `//host` are all refused —
  including obfuscated forms like `java\tscript:`, which a browser resolves but
  a naive prefix check does not. See `isSafeHref` in
  `src/lib/schemas/storefront.ts`.
- **Text is a restricted markdown subset**, parsed to a token tree by
  `src/lib/utils/miniMarkdown.ts` and rendered as React elements. Headings,
  paragraphs, lists, quotes, bold, italic, code, links. Everything else is
  literal text.
- **Forward compatibility is free.** A block whose `type` this version does not
  know is dropped and the rest of the page still renders, so an old client
  meeting a new page degrades instead of erroring.

The closed block union is what keeps this bounded. It must not be relaxed for
convenience later.

## Blocks

| Block             | Data it reads                       | Notes                                |
| ----------------- | ----------------------------------- | ------------------------------------ |
| `ProfileHeader`   | author's kind 0                     | live, never copied into the document |
| `Hero`            | —                                   | optional background image and CTA    |
| `Text`            | —                                   | restricted markdown                  |
| `ProductGrid`     | author's kind 30402 listings        | all listings, or one collection      |
| `FeaturedProduct` | one of the author's listings by `d` | resolved from the author's own set   |
| `LinkList`        | —                                   | https / in-app links only            |
| `Image`           | —                                   | https / in-app sources only          |
| `Divider`         | —                                   |                                      |
| `Spacer`          | —                                   |                                      |

Data blocks resolve their queries against the **page author's pubkey, taken from
React context, never from a prop**. A page document therefore has no field
capable of expressing "show somebody else's products under my name". Nothing is
denormalised into the document either — no cached titles, no cached prices — so a
page can never quote a price the seller has since changed.

## Architecture

```
src/lib/schemas/storefront.ts          the closed block union, URL gates, parse/validate
src/lib/utils/miniMarkdown.ts          restricted markdown -> token tree
src/publish/storefront-page.ts         build, sign and publish kind 30024
src/queries/storefront.tsx             fetch, replaceable-event selection, publish mutation
src/components/storefront/
  StorefrontRenderer.tsx               exhaustive switch: block -> component
  StorefrontContext.tsx                { pubkey, isEditing }
  StorefrontLink.tsx                   the one anchor, re-gating every href
  MiniMarkdown.tsx                     token tree -> React elements
  blocks/*.tsx                         one presentational component per block
  builder/StorefrontBuilder.tsx        Puck shell: load, draft, validate, publish
  builder/draftStorage.ts              localStorage drafts, validated on read
  builder/fields/ItemPickerField.tsx   product / collection pickers for the sidebar
src/config/storefrontCms.tsx           Puck config: block type -> sidebar fields
src/components/pages/StorefrontOrProfilePage.tsx   resolve -> page or profile
```

Two decisions worth knowing when changing this:

**The editor canvas is the production renderer.** Every `render` in
`storefrontCms.tsx` delegates to `StorefrontBlockView`, the same switch the
published page uses. The canvas is the page with editor chrome around it, so
preview drift is not something to keep in sync — it cannot happen. Puck's iframe
is disabled for the same reason: inline rendering keeps the canvas inside the
app's own stylesheet and React tree.

**Validation happens three times, on purpose.** Strictly before signing (so the
author is told, not silently trimmed); leniently on read (so one bad block does
not take down a page); and again at render for every URL (because the document
crossed a relay between the first two, and a value validated only once is only
validated on the path we thought about).

### Persisted shape == Puck's shape

Puck's `Data` is `{ root: { props }, content: [{ type, props: { id, ... } }] }`,
and so is the document. There is no translation layer, so the thing validated is
exactly the thing the editor produced and exactly the thing the renderer
consumes.

## Editing flow

Drafts go to `localStorage` on every change, keyed per pubkey, and are
re-validated when read back (localStorage is writable by anything on the origin).
Pressing **Publish** opens an optional identity step before the page event is
published. Authors enter one name; the current site's domain is added to form
the NIP-05 address, and that name becomes the vanity URL path. One Lightning zap invoice
registers both names in the unified storefront identity registry. A matching
legacy identity owned by the author is migrated on renewal, and the combined
validity is extended from the later existing expiry. If exactly one matching
legacy identity exists, the invoice covers the missing identity only;
otherwise it covers both. Availability is advisory and the server remains
authoritative. Creating an invoice opens a separate payment modal, hiding the
name and publication controls while payment is pending. The payment modal keeps
the invoice visible and cannot be dismissed until a zap receipt is observed;
payment errors remain visible there so the author can retry. Once the receipt
is observed, the payment modal closes and the publish dialog returns.
The UI then waits for the
matching active unified registry entry before it allows publication with that
identity. A wallet acknowledgement or receipt alone is not treated as
registration activation.

Neither identity is required to publish. **Publish without buying an identity**
publishes the page normally, and it remains reachable by profile pubkey. This
preserves the page/identity separation: a name controls the short route, not
ownership of the page.

Draft edits remain local until the author explicitly continues to publication;
the editor does not relay-publish half-finished content on each change.

Publishing fails closed on zero relay ACKs, and the success toast names how many
relays accepted rather than claiming "saved". After publishing an enabled page,
the author is redirected to their active vanity URL when one is available;
otherwise they remain in the builder and can use the profile URL.

## Testing

```bash
bun test --isolate src/lib/schemas/storefront.test.ts \
  src/lib/utils/miniMarkdown.test.ts \
  src/queries/__tests__/storefrontPage.test.ts

bun run test:e2e -- e2e/tests/storefront-page-builder.spec.ts

bunx playwright test --config=e2e/playwright.subdomains-local.config.ts \
  e2e/tests/storefront-page-builder.spec.ts \
  --grep 'serves registered storefront subdomains'
```

The dedicated local subdomain config starts/seeds the local app and relay with
the base URL enabled and omits the Cashu mint, which this flow does not use.
The test records video, intercepts external HTTP/WebSocket requests, and covers
publication, canonical redirects, same-origin author drafts, unknown/expired
names, and the ordinary base-domain homepage. The standard config skips this
opt-in case. CI must start the app with the same base-URL setting before using
the dedicated config, because CI manages its own services.

The e2e spec covers build → optional combined identity purchase step → publish
→ visit → render. The accepted-payment case uses a mocked invoice, a locally
signed zap receipt on the test relay, then a separate synthetic unified registry
update; it does not contact an external payment service or claim to test
server-side invoice acceptance. Payment receipt and identity activation remain
separate states. The suite also covers the ADR-019 guardrail that a hostile page event (script URLs,
`javascript:` hrefs, unknown block types, oversized payloads) renders inert. It
uses throwaway keypairs for hostile cases: an enabled page replaces the profile
view for whoever authored it, so enabling one on a shared fixture account would
change what every other spec sees.

The `business template` cases cover selecting all four starters, keeping their
suggested theme, editing a hero in Puck, publishing to the local relay, and
viewing the standalone mobile page with real seeded merchant listings. They
record video, intercept external HTTP and WebSocket requests, and require only
the local app and relay, not the Cashu mint.

## Relationship to the ADRs

- **ADR-019** supplies both halves: kind 30024, `d=storefront-page`,
  user-signed, closed block union, no raw HTML, `$vanityName` fallback chain,
  and a unified `StorefrontIdentityManager`. Its one invoice activates the
  NIP-05 and vanity forms together; neither identity nor purchase is required
  to publish a page.
- **ADR-0006** supplies the editor: Puck, with components registered through a
  config that maps block types to sidebar fields.
- ADR-019 rejects "third-party CMS or headless builder integration" on the
  grounds that it "adds an external service dependency". Puck is an npm library
  that runs entirely client-side, so it adds no service dependency and no
  network egress; the rejection does not reach it. Its other rejection —
  "build a general website builder" with arbitrary nesting and custom CSS — is
  respected: this is a fixed block list with no nesting and no CSS field.
- ADR-019 also sketches an explicit move-up/move-down builder rather than
  drag-and-drop. Puck supplies both drag-and-drop and a keyboard-navigable
  outline, so that constraint is met by the library rather than by hand.

## Known gaps

- **No image host allowlist.** ADR-019 calls for images to resolve through "the
  existing Blossom/NIP-96 host allowlist"; no such allowlist exists in the repo
  yet, so `isSafeMediaSrc` enforces the scheme only. Adding a host check later
  is a tightening of that one function and needs no schema change.
- **One page per pubkey.** ADR-019 leaves per-name pages
  (`d=storefront-page-{name}`) as an open question; the `d` tag would change if
  that is answered differently.
- **No nesting.** Blocks are a flat list. ADR-0006's recursive `children` model
  is not implemented; adding it later means adding a field, not migrating.
- **Bundle cost.** Puck adds roughly 2MB of JS and 100KB of CSS. The build has
  no code splitting configured, so this lands in the main bundle rather than
  only on the builder route.
