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
  URLs and in-app absolute paths. `javascript:`, `data:`, `blob:`, `file:`,
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
**Publish is the only network write in the editor** — a builder that auto-saved
to relays would ask the author's signer to approve an event per keystroke and
leave half-finished pages live.

Publishing fails closed on zero relay ACKs, and the success toast names how many
relays accepted rather than claiming "saved".

## Testing

```bash
bun test --isolate src/lib/schemas/storefront.test.ts \
  src/lib/utils/miniMarkdown.test.ts \
  src/queries/__tests__/storefrontPage.test.ts

bun run test:e2e -- e2e/tests/storefront-page-builder.spec.ts
```

The e2e spec covers build → publish → visit → render, plus the ADR-019 guardrail
that a hostile page event (script URLs, `javascript:` hrefs, unknown block types,
oversized payloads) renders inert. It uses throwaway keypairs for the hostile
cases: an enabled page replaces the profile view for whoever authored it, so
enabling one on a shared fixture account would change what every other spec sees.

## Relationship to the ADRs

- **ADR-019** supplies the page half: kind 30024, `d=storefront-page`,
  user-signed, closed block union, no raw HTML, `$vanityName` fallback chain.
  Its _identity_ half (merging the NIP-05 and vanity registries into one
  `StorefrontIdentityManager`) is untouched here — this change adds no server
  code and no purchase flow.
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
