# nsite page interop (kind 34128)

External compatibility context. This document describes how the storefront CMS
interoperates with **nsite static pages**, the page format published by
`bitkarrot/nostr-cms` (deployed via `setupcms.hivetalk.org`). The format is
described here from _that project's own publisher and reader_, not from a spec
document — every claim below was read off the code.

> Per `docs/AGENTS.md`, the comparison to nostr-cms is external compatibility
> context. Where this document and this repository's code disagree, the code
> wins.

## Why 34128 and not 30024

Our storefront page is **kind 30024, `d=storefront-page`**: one page per pubkey,
carrying validated block JSON inline.

An nsite page is **kind 34128**: addressable, keyed by URL path (`d` tag), and
the event is a _pointer_ — the page document itself is uploaded to Blossom and
the event carries its hash.

So the two systems agree that "a page lives at an address and is owned by a
pubkey" and disagree about almost everything else. **The shared vocabulary is
the path.** That is why the path is the join key, and why it is validated rather
than trusted.

## The format, as nostr-cms emits it

From `src/components/admin/AdminPages.tsx` (the publisher):

| Tag / field        | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| `kind`             | `34128`                                                     |
| `d`                | the URL path, always leading-slashed (`/about`)             |
| `sha256`           | the Blossom blob hash of the page document                  |
| `alt`              | `Static page for /about`                                    |
| `relay`            | zero or more Blossom server URLs, repeated                  |
| `homepage_section` | `true` when the page belongs on their homepage (optional)   |
| `content`          | the page body, used as a fallback when there is no `sha256` |

The blob is a **complete HTML document** — `<!DOCTYPE html>…<body>{content}</body>`
— uploaded as `index.html` with `text/html`.

From `src/pages/StaticPage.tsx` (the reader):

1. Query the default relay: `{ kinds: [34128], '#d': [slashedPath, unslashedPath] }`.
2. Take the `sha256` tag; fetch `GET {blossomServer}/{sha256}`.
3. **Verify the returned bytes hash to that digest**, and skip a server that
   lies.
4. Render: if the content starts with `<`, inject it as HTML; otherwise render
   it as markdown.

## What this repository implements

- **`src/lib/schemas/nsitePage.ts`** — the single definition of a valid nsite
  page, per `AGENTS.md` ("Every event kind the app renders must have a parser
  under `src/lib/schemas/`"). It parses an event into a typed page, validates
  the path (absolute, no traversal, no control characters, bounded), the digest
  (64 lowercase hex), and every `relay` tag (an `https:` origin, no credentials,
  no query or fragment). It also **builds** the event template with the same
  tags in the same order nostr-cms uses, so a page published from here is
  readable there.
- **`src/lib/blossom.ts` → `fetchBlossomBlob`** — a hash-verified blob fetch.
  This mirrors the strongest part of nostr-cms's reader: the digest is the whole
  trust model, and bytes that do not match it are discarded rather than logged.
  The app previously had Blossom _upload_ but no verified _download_.
- **`src/queries/nsitePage.tsx`** — a read path that queries by path through
  `src/lib/nostr/io.ts` (the only sanctioned relay seam) and returns the newest
  event per author, tie-broken on lowest id.

## The two divergences, stated plainly

**1. We do not render their HTML.** nostr-cms renders the fetched document
through `dangerouslySetInnerHTML` behind a DOMPurify allowlist that includes
`iframe` and `style`. This repository must not, and the reason is already
written down: the storefront path accepts no HTML at all, because this
application holds wallet material and an injection here "would be an
account-draining XSS rather than a defacement" (`src/lib/schemas/storefront.ts`,
`docs/storefront-page-builder.md`).

Nothing in the interop module returns HTML for injection. The parser hands back
a string and the query hands back a `NsitePage`; deciding whether those bytes may
ever be shown is a separate, reviewable decision that has not been taken.

**2. The content is not transferable, only the address is.** Their page body
lives on Blossom as a document; ours lives in the event as structured blocks.
Publishing our page as a 34128 would give it a path in their world but would not
make it _render_ there, because their renderer expects a document and ours is
data. Anything that makes our storefront appear correctly in a nostr-cms
instance has to render our blocks to a static document at publish time, and that
is a rendering decision this change deliberately does not make on its own.

## What this change does not do

- No publish UI, and no new write path. `buildNsitePageTemplate` returns an
  unsigned template; wiring it to a Blossom upload and a signer is a further
  step with its own review.
- No rendering of foreign page bodies anywhere in the app.
- No change to relay assumptions, payment semantics, or egress beyond the one
  read path above, which goes through the existing `io.ts` seam and the existing
  configured relays.
- The `src/publish/` half is intentionally absent: publishing a second event
  kind on a user's behalf is a product decision as much as a technical one.

## The decision a maintainer has to make

Interop here means shared _addressing_, not shared _rendering_. Two questions
follow, and neither is answered by this change:

1. **Should our storefront publish a 34128 mirror of the page** so a nostr-cms
   instance can serve it? That means rendering blocks to a static document, and
   it means asking the author's signer for a second event per publish.
2. **Should we ever render a foreign nsite page?** If the answer is ever "yes",
   the safe shape is a restricted-markdown-only path — the HTML branch cannot be
   taken, and a page whose body is HTML should be reported as unrenderable
   rather than sanitised and hoped for.
