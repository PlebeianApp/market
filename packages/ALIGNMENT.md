# Chapter 04 alignment and drift review

**Reviewed 2026-09-22** against the implementation at `91e55a23` (PR #1385, the first prototype), then
**re-checked against the restructured tree** — see §6 for what has since changed.

Source: **Chapter 04 — "Anatomy of a module: Spec, then packages, then implementations"** in _One platform.
Many modules. No landlord._ (the ideas document at
`npub1qgnmdjse6e984a4z799qug6p3hr4uecz8kshyzjuxdwv9446skwsj08qd5.nsite.lol`), read from the rendered page.

**Verdict in one line:** the **shape** matched — three steps, core/bindings/components, two trust boundaries
— but the implementation **drifted in nine specific places**, and four mattered: the spec did not lead, the
core was over-split, the tokens were baked in, and the implementation was not installable.

---

## 1. What Chapter 04 actually says

The intro: _"This is the three-step build order for every module. The spec is the contract; the packages are
what make Plebeian a **platform** rather than a product; the implementations are how the same module appears
in a web page, a native app, a 3D world or someone else's node."_

**01 — CORE SPEC** · _one document per module, platform-neutral_ — _"The module contract: what it does, the
data representation, the participants and their roles, and how they communicate. Platform-neutral, versioned,
and the only place a behaviour change is defined."_ Diagram caption: _"one job · one interface · versioned."_

**02 — REUSABLE PACKAGES** · _what makes it a platform, not a product_ — the diagram names exactly three
kinds:

- **core — pure logic**: _"schemas · validation · arithmetic · protocol"_
- **bindings — per runtime**: _"in-process today · sandboxed tomorrow"_
- **components — token themed**: _"props in, tokens applied, CMS-ready"_

with the caption _"used by our app, by other people's nodes, by forks, by agents — the same package, many
bodies"_, and the paragraph: _"Pure core logic, bindings per runtime, themeable components. Anyone can
install them: our app, another circle's node, a fork, an agent. This layer is the platform."_

**03 — IMPLEMENTATIONS** · _how it appears, and how much you must trust it_ —

- **CMS components**: _"higher trust boundary · declared, hashed, reviewed — runs in-process with the
  platform's capabilities"_
- **Napplets**: _"lower trust boundary · nostr applets, sandboxed — no keys, no network, no durable
  storage"_
- surfaces: _"web · native · 3D world · embedded through Totem"_
- alongside: _"agent skill files — so Continuum can drive the modules"_ and _"sniper relay app spec — what
  the node indexes & validates"_

Caption: _"one spec → one package set → many implementations."_

---

## 2. Where the implementation aligns

**A1 — The three-step order is real, not decorative.** The spec came first
(`rebuild-research/modules/browsing-explore-search.md`, 1,026 lines, versioned `browsing/0.5.0-draft`), then
the packages, then three projections. The order held.

**A2 — "core — pure logic: schemas · validation · arithmetic · protocol".** `product-event` was exactly
that: per-tag schemas, `parseListing`, the kind-30402 protocol shape. One dependency (`zod`), no application
imports.

**A3 — "bindings — per runtime: in-process today · sandboxed tomorrow".** Two real bindings — in-process
over `nostr-tools`, and the sandboxed napplet binding — plus a fixture binding for tests. The
cross-adapter invariant is tested: the same fixtures produce identical validated listings through all
three.

**A4 — "props in … CMS-ready".** Components take a validated value plus an environment and return markup;
they fetch nothing and read no store. CMS-readiness is demonstrated rather than asserted: the explorer's CMS
projection renders a page definition through component **manifests**, with no per-component code.

**A5 — "Napplets: no keys, no network, no durable storage".** The sandbox binding has no signer, no fetch,
and treats storage as advisory-only. Aligned by construction rather than by promise.

**A6 — "higher trust boundary … runs in-process with the platform's capabilities".** The CMS projection runs
in-process with the full environment, which is the described posture.

---

## 3. Where it drifted

Ordered by how much they mattered. **Status** is §6.

### D-1 — The spec did not lead.

Chapter 04 makes the spec _"the only place a behaviour change is defined"_. The spec was **outside the
artifact it governed**: in `rebuild-research/modules/`, a research directory, while the code sat in the
repository with **no accompanying spec at all**.

Worse, and precisely measurable: the implementation **changed behaviour in a way the spec does not record**.
Two decisions were taken in code and written up in a _decisions_ document:

- **D7** — the currency rule widened from `/^[A-Z]{3}$/` to `/^[A-Za-z]{3,4}$/`.
- **D8** — an absent `price` moved from fatal (Gamma-required) to tolerated-and-named (NIP-99 SHOULD).

Both are behaviour changes. By Chapter 04's rule they belong in the core spec **before** they are legitimate;
instead the spec still says `price` is required and says nothing about the currency rule's width. **The spec
and the code disagreed, and the code is what shipped.**

### D-2 — The core was over-split, and the package set did not match the anatomy.

Chapter 04 names **three** kinds of package per module. The prototype shipped **five packages**, three of
them the _same kind_:

| Chapter 04 kind           | Prototype packages                                |
| ------------------------- | ------------------------------------------------- |
| core — pure logic         | `product-event`, `product-query`, `browse-filter` |
| bindings — per runtime    | `nostr-access`                                    |
| components — token themed | `browse-ui`                                       |

The layering was sound and the separation rule was enforced, but it was **not the documented anatomy**, and
"one spec → one package set" started to read as "one module → five artifacts whose boundaries were chosen
locally".

### D-3 — Tokens were baked in, and the document says "token themed".

Chapter 04's caption for components is _"props in, **tokens applied**, CMS-ready"_. The components applied
hard-coded tokens instead:

- `nostr-access/src/index.ts:75` defined `defaultTheme` — **eight colour literals** — inside a package;
- `browse-ui/src/styles.css` contained **10 hex colour literals** _and its own token block_;
- `nostrAccessEnvironment.ts:34` hard-coded a `SEARCH_RELAYS` set — host policy in a package;
- `browse-filter/src/index.ts:29` hard-coded `defaultProductFilters` — product policy.

Every one of those values also exists, or will exist, in the host. That is the duplication the maintainer
called a no-go.

### D-4 — "Anyone can install them" was not true.

The packages were `private: true` and resolved through **tsconfig path aliases**, not through any package
manager. Nothing could be installed, by us or anyone else. "Used by our app" was also false: the application
has not been migrated onto the packages.

### D-5 — "declared, hashed, reviewed" — only "declared" existed.

The CMS trust boundary requires _declared, hashed, reviewed_. The prototype implemented the **declaration**
(the four-section manifest) and nothing else: **no hash and no review gate**, so the CMS projection was
ordinary local code that happened to be manifest-driven. It was a simulation of the higher-trust path, not
the path.

### D-6 — Step 3's implementation kinds were almost entirely absent.

Chapter 04 lists **web · native · 3D world · embedded through Totem**, plus _"agent skill files"_ and a
_"relay app spec"_. The prototype delivered **web only**, and the sandbox projection was an explicit
**stub** — honestly labelled, but not a sandboxed napplet. The honest count is **one implementation plus two
simulations**.

### D-7 — The trust boundary was not surfaced where a reader would look for it.

Chapter 04 organises step 3 **by trust boundary**. The prototype's views were organised **by host** (live /
CMS / sandbox), and the words "higher trust" and "lower trust" appeared nowhere in the code or the README. A
reader could not tell from the artifact which boundary a projection sat on — the one thing step 3 is _for_.

### D-8 — "one job · one interface · versioned" — the versioning was incomplete.

The spec was versioned ✅. But nothing linked a _package_ to the spec revision it implemented: `package.json`
declared `0.1.0` with no reference to `browsing/0.5.0-draft`, so a package could not state which contract it
satisfied.

### D-9 — A behaviour change was recorded in the decisions document instead of the spec.

Related to D-1 but distinct in kind: `docs/DECISIONS-packages-prototype.md` became the authoritative record
of D7 and D8, and the feature spec was not. That inverts Chapter 04's hierarchy — a decisions log above the
contract.

---

## 4. Where the document is thinner than the implementation needs

An honest two-way review: two things the implementation needed and Chapter 04 does not supply.

**Db-1 — "tokens applied" names no resolution mechanism.** The document says components are token themed, but
not _where tokens come from_ in a build with no host — the napplet case, where there is no shared runtime and
no import map. The build-time-injection-versus-runtime-import contract is the missing piece;
`MODULARIZATION.md` proposes it. Without it, "token themed" and "stand-alone" contradict each other, which is
exactly the corner the prototype got stuck in.

**Db-2 — "bindings — per runtime" is drawn inside the module, but is shared in practice.** Every module needs
the same bindings. Drawing them per module would duplicate them across modules. The maintainer's resolution —
implementations are separate modules and **only the contract is shared** — is not what the diagram shows, and
the diagram should probably agree with it.

---

## 5. Method and limits

- Chapter 04 was read from the rendered ideas document; the quotes are verbatim from that page. **The page is
  a static artifact with no version or commit** — if it is edited, these quotes need re-checking. That is
  itself an instance of the document's own argument: a spec that cannot be versioned cannot be the contract.
- Code claims cite the tree at `91e55a23`. Counts (`five packages`, `10 hex literals`, `eight colour
literals`) were taken by reading those files, not estimated.
- This review judges the prototype against Chapter 04 only. Chapter 03's module list — which fixes "browsing &
  search" as a single module — was used as context, not as a reviewed source.

---

## 6. Status after the restructure

The maintainer's feedback (2026-09-22) named D-1, D-2, D-3 and the spec-first ordering directly; this review
added D-4 through D-9. What the restructure addressed:

**Fixed**

- **D-2** — the package set now matches the anatomy: `contract` (the shared vocabulary and interface),
  `product` (core, merged from `product-event` + `product-query`), `browse` (components, merged from
  `browse-ui` + `browse-filter`), plus `web` and `napplet` as **separate implementation modules** with no
  shared code.
- **D-3** — colour values exist once, in `contract` (`TOKEN_FLOOR` + `tokens.css`), with a test that fails
  the pair when the two encodings disagree. `SEARCH_RELAYS` became an injectable contract default.
  `browse/src/styles.css` has **zero** hex literals and defines no token values. Enforced by
  `packages/__tests__/conformance.test.ts`.
- **D-7** — every implementation declares its boundary in a descriptor (`in-process` / `napplet`), asserted
  by tests.
- **D-1, D-8, D-9 (partly)** — every package now carries a `SPEC.md` declaring the feature-spec version it
  implements, and `CONTRACT.md` is the overarching spec with the dependency rule drawn and checked.

**Still open — and deliberately recorded rather than quietly dropped**

- **D-1, D-9 (the substance)** — D7 and D8 are **still not written back into `browsing-explore-search.md`**.
  The package spec now _names_ the divergence instead of hiding it, which is honest but not sufficient: until
  the feature spec carries the revised rules, the code implements an unpublished revision.
- **D-4** — packages remain `private: true`, resolved by tsconfig aliases. No workspace wiring, no exports
  map that survives a publish, no application migration.
- **D-5** — no hash, no review gate on the CMS boundary. `in-process` is declared, not earned.
- **D-6** — still one implementation plus two simulations. No native, no 3D, no Totem, no agent skill files,
  no relay spec.
- **Db-1** — the resolution mechanism is specified in `MODULARIZATION.md` but **not implemented**: the
  stand-alone (Mode A) build is the one verification step of four that does not exist yet.
