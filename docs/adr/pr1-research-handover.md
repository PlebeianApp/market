# PR 1 Research Handover — Component UI Migration

> Status: Research notes for the agent implementing **PR 1 (Foundation – Styles)** of
> [ADR: Component UI Migration & Widget Book](./ADR-component-ui-migration-and-widget-book.md).
> This document catalogues the dominant anti-patterns found across `src/components/` and `src/routes/`
> as of branch `adr/ui-components-migration` (commit `67f0ea78`, ADR-only, no implementation yet).
> It is descriptive evidence, not a spec — the consistent solution architecture is the next step.
>
> **⚠ ADR defect — `@layer legacy` is not viable.** The ADR's original migration tracker
> mechanism (`@layer legacy { ... }` wrapping, ADR §1a/§2b/Consequences) does not work as a real
> Tailwind v4 cascade-layer quarantine and has been confirmed to be largely unworkable. A working
> alternative already exists on branch `feat/theme-migration`: a **class-scoped `.theme-new` token
> block + a `ThemeMigrationWrapper` React component** that opts migrated subtrees into the new
> theme, enabling **slice-by-slice migration** (the property that matters; the rest of the ADR's
> goals are unaffected). See the "Theme migration mechanism" note at the end of this doc (§8).
> Every `@layer legacy` reference below should be read as "the equivalent `.theme-new`-scoped
> migration step"; the ADR has since been amended accordingly.

## How to read this

Each section maps to an ADR concern. Findings are grouped, with concrete file:line evidence and, where
useful, aggregate counts. A short "PR 1 implication" note closes each section describing what the
foundation PR must establish to unblock later migration slices.

Quantitative summary (across `src/components/**` + `src/routes/**`, `.tsx` only):

| Signal | Count |
|---|---|
| Hardcoded `text-gray-*` utility uses | ~250+ (gray-500: 108, gray-600: 80, gray-400: 32, gray-900: 28, gray-700: 20, gray-300: 12) |
| Hardcoded `text-red-*` | 91 red-500, 30 red-600, 20 red-700 |
| Hardcoded `text-white` / `text-black` | 79 / 31 |
| Hardcoded `bg-white` / `bg-black` | 68 / 22 |
| Hardcoded status-chip pairs (`bg-X-100 text-X-800`) | scattered, ~8 distinct color families |
| Files with inline `style={{ }}` | 19 |
| `!important` rules injected from `.tsx` | 5 (all `useHeroBackground`) |
| Components using string-concat className (not `cn()`) | 7+ (social/*, UserCard, AvatarUser, Nip05Badge) |
| `forwardRef` components | 6 of ~125 |
| Components calling stores/queries inline | 53 |
| `useHeroBackground` hook copies | 5 (one per hero route) |
| `handlePostToNostr` sign/publish-with-timeout copies | 3 (ShareDialog, ShareProductDialog, BugReportModal) |

---

## 1. Redefinitions / non-DRY components

### 1a. The hero carousel is duplicated across 5 routes (largest DRY violation)

`src/routes/index.tsx`, `src/routes/products.index.tsx`, `src/routes/community.index.tsx`,
`src/routes/products.$productId.tsx`, `src/routes/collection.$collectionId.tsx` each define their **own
identical copy** of:

- `function useHeroBackground(imageUrl, className)` — injects a `<style>` tag into `<head>` with
  `background-image: url(...) !important;`. This is the source of all 5 `!important` hits and a direct
  violation of ADR 1a ("no `!important` rules", "no custom selectors"). Evidence:
  `index.tsx:~18`, `products.$productId.tsx:~71`, `products.index.tsx:~18`, `community.index.tsx:~25`,
  `collection.$collectionId.tsx:~38`.
- The hero chrome markup: `hero-container*` + `hero-overlays` + `bg-radial-overlay opacity-40` +
  `bg-dots-overlay opacity-20` + `hero-content`. This shell is copy-pasted verbatim per route.
- Touch-swipe handlers (`handleTouchStart/Move/End`, `touchStartX`/`touchEndX` refs, `minSwipeDistance`).
- Auto-slide interval effect (`setInterval` 8s, `setCurrentSlideIndex`).
- Pagination dots markup (`Array.from({length: totalSlides}).map(...)` with `bg-white scale-125` vs
  `bg-white/40`) — duplicated **4× within `products.index.tsx` alone** and again in `community.index.tsx`.

`products.index.tsx` and `community.index.tsx` are near-mirror images of each other (one renders
products, the other collections) — `renderHomepageHero` / `renderProductHero` / `renderCollectionsHero`
are inline `const` components that should be extracted.

**PR 1 implication:** Foundation doesn't migrate these, but it must (i) move all `hero-container*`,
`hero-overlays`, `hero-content*`, `bg-radial-overlay`, `bg-dots-overlay`, `bg-hero-image*`,
`back-button` utilities relocated under the `.theme-new` scope (or, for unmigrated UI, left in the legacy `globals.css` outside the scope) so they're tracked, and (ii) the later "Home Page"
migration slice will collapse the 5 copies into a single `HeroCarousel` + `useHeroBackground` hook
relocated out of routes (routes must import UI only from `src/components/` per ADR 1d).

### 1b. Three Share dialogs are the same component

`src/components/dialogs/ShareDialog.tsx`, `ShareProductDialog.tsx`, `ShareProfileDialog.tsx`:

- `ShareDialog` and `ShareProductDialog` share **byte-for-byte identical** `handleCopyUrl` and
  `handlePostToNostr` implementations, including the `Promise.race([signPromise, signTimeoutPromise])`
  + `Promise.race([publishPromise, publishTimeoutPromise])` timeout-race pattern.
- Same dialog shell (`Dialog`/`DialogContent`/`DialogHeader`), same "Copy URL" + "Post to Nostr"
  button row, same `bg-white` hardcoded `DialogContent`.

A **third** copy of the sign/publish-with-timeout race lives in `src/components/BugReportModal.tsx`.

**PR 1 implication:** Extracting a `useShareToNostr()` / `usePublishWithTimeout()` publish helper
belongs to a later migration slice, but the duplicate `bg-white` `DialogContent` override is a
foundation concern: there is no shared "dialog shell" wrapper, so each dialog re-hardcodes surface
colors. A `ui-wrappers/` dialog wrapper should be considered as one of the PR 1 "Modify" example
components.

### 1c. Card pattern redefined inline instead of using `ui/card`

`ProductCard.tsx:88` and `CollectionCard.tsx:22` both define the same card:
`border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col` + an `aspect-square` image slot
+ a "No image" placeholder (`bg-gray-100 ... text-gray-400`). Neither imports `ui/card`.
`FeaturedUserCard.tsx` *does* import `ui/card` but then layers `bg-background`/`hover:shadow-lg` on top.

The product-detail route (`products.$productId.tsx`) redefines a card inline via
`wrapContent = (content) => <div className="bg-white shadow-md p-6 rounded-lg">{content}</div>`.

**PR 1 implication:** Foundation should standardize a `MediaCard` / `EntityCard` wrapper in
`ui-wrappers/` (square image + content slot) so later slices Replace these inline definitions. The
`zinc-800`/`bg-white`/`bg-gray-100` colors are token violations (§2).

### 1d. Status / stock badges redefined everywhere

Stock/visibility/state chips are re-implemented ad hoc with hardcoded Tailwind pairs:

- `ProductCard.tsx`: `bg-amber-500 text-white` (NSFW), `bg-blue-100 text-blue-800` (Pre-order),
  `bg-red-100 text-red-800` (Out of stock), `bg-[var(--light-gray)]` (in stock),
  `bg-pink-100 text-pink-800 border-pink-300` (cart quantity).
- `products.$productId.tsx`: `bg-blue-500` (Pre-order Badge), `bg-amber-600 hover:bg-amber-700`
  (NSFW enable), `text-amber-500` (AlertTriangle).
- Orders: `bg-green-100 text-green-800`, `bg-green-50 border-green-200`,
  `bg-yellow-50 border-yellow-200 text-yellow-800`, `bg-pink-400`.

These map 1:1 onto the ADR's proposed UX-state tokens (`info`=blue, `warning`=amber/orange,
`error`=red, `success`=green). Today each component invents its own shade.

**PR 1 implication:** The UX-state tokens (`info/warning/error/success` with fg/bg/border) in §1a of
the ADR are the highest-leverage addition in PR 1. Once they exist, a `StatusBadge` /
`StatusChip` wrapper in `ui-wrappers/` (or a `variant` on `ui/badge`) can Replace all of these.

### 1e. Header action buttons repeat one shape

`src/components/layout/Header.tsx` defines `LoginButton`, `LogoutButton`, `ProfileButton`,
`CartButton`, `DashboardButton`, `WalletButton`, `BugReportButton` — all built on `TooltipButton`
with the same `btn-border-highlight w-11 h-10 p-2` shell and a notification-badge pattern
(`bg-secondary rounded-full w-5 h-5 font-bold text-black text-xs`) repeated in `CartButton` and
`DashboardButton`. The `text-black` on `bg-secondary` is a latent dark-mode bug (dark `--secondary`
is light, so black-on-light is fine, but light-mode `--secondary` is pink `#ff3eb5`, where black is
legible — yet the intent is inconsistent with `text-secondary-foreground`).

**PR 1 implication:** This is a `ui-wrappers/` `IconButton` + `NotificationBadge` opportunity, but
the more urgent foundation issue is the `btn-border-highlight` custom utility living in
`@layer utilities` of `globals.css` — under the `.theme-new` migration model it stays in the legacy
`globals.css` (outside the `.theme-new` scope) until the `Button` variant system replaces it, at
which point it is deleted.

---

## 2. Manually-defined colours and colour schemes

### 2a. Legacy utilities live in `utilities`/`base` with no quarantine

`styles/globals.css` currently has `@layer base` and `@layer utilities` only. Everything the ADR
wants deprecated — `btn-border-highlight`, `bg-radial-overlay`, `bg-dots-overlay`, `bg-header-*`,
`bg-hero-image*`, `hero-container*`, `hero-content*`, `back-button`, the global `*:focus-visible`
`!important` overrides, the global `button { text-transform: uppercase }` override — sits in
`@layer utilities`/`@layer base` with no deprecation markers. Under the `.theme-new` approach (§9),
PR 1 defines the new token system in a scoped block and leaves these legacy utilities in the
unscoped `globals.css`; they are deleted piecemeal as each slice migrates its consumers into the
`.theme-new` scope. This is the core PR 1 deliverable.

### 2b. Token system is non-standard and light/dark are incoherent

`:root` defines a custom naming scheme (`primary/secondary/tertiary/focus` each with
`-hover`/`-foreground`/`-foreground-hover`/`-border`/`-border-hover` variants) plus raw custom colors
(`--neo-purple`, `--neo-blue`, `--secondary-black`, `--tertiary-black`, `--light-gray`, `--off-black`).
`.dark` only redefines the standard Shadcn subset (`primary`, `secondary`, `muted`, `accent`,
`destructive`, `border`, `input`, `ring`, chart/sidebar tokens) and **omits all the custom
`-hover`/`-foreground-hover`/`-border-hover` variants** — so in dark mode those fall back to the
`:root` (light) values. This is the "dark mode lacks coherence with light theme" symptom the ADR
calls out.

`SelectableBadge.tsx` (in `shared/`) uses `primary-border-hover`, `primary-foreground-hover`,
`bg-primary-border-hover` — tokens that only exist in light mode.

### 2c. Fonts: `font-sans`/`font-heading`, no `font-body`/`font-header`

`@theme` defines `--font-sans` (IBM Plex Mono) and `--font-heading` (reglisse), plus `--font-theylive`.
ADR 1a wants `font-body`/`font-header`. `font-sans` is still used directly in components
(`UserCard.tsx:123`). `font-heading` is used via the `@layer utilities` `.font-heading` class and
inline (`ItemGrid`, `InfiniteProductList` title headings).

### 2d. Hardcoded color hotspots (representative, not exhaustive)

- `ProductCard.tsx`: `bg-black`, `text-white`, `bg-gray-400`, `border-zinc-800`, `bg-gray-100`,
  `text-gray-400`, `bg-gray-200`, `bg-amber-500`, `bg-blue-100 text-blue-800`, `bg-red-100 text-red-800`,
  `bg-pink-100 text-pink-800 border-pink-300`, `bg-[var(--light-gray)]`.
- `ProductSearch.tsx:93`: `bg-[#1c1c1c]`.
- `auth/NostrConnectQR.tsx:373-374`: QR `bgColor="#ffffff" fgColor="#000000"`.
- `dialogs/PickupLocationDialog.tsx:138`: inline HTML string with `color: #71717a`.
- `pages/ProfilePage.tsx:245,376,402`: `linear-gradient(... ${hex} 0%, #000 100%)` and `hsl(0,0%,30%)`.
- `FeaturedUserCard.tsx`: `hover:text-blue-600`, `text-foreground/90`, `text-foreground/80`,
  `text-foreground/70`, `bg-background/80`, `bg-background/90`.
- `Header.tsx`: `bg-black`, `text-white`, `text-black`, inline `rgba(0,0,0,*)` gradient styles.
- `Footer.tsx`: `bg-black`, `text-white`, inline `style={{ filter: 'invert(1)' }}` (×3) +
  `brightness(0) invert(1)`.
- `AvatarUser.tsx`: `bg-neo-purple text-white` (custom token used as a one-off).
- `Nip05Badge.tsx`: inline `style={{ fill: 'var(--secondary)', color: 'var(--primary)' }}`.
- `Hero.tsx`: inline `style={{ backgroundColor: 'black' }}` + radial-gradient with `var(--secondary)`.
- `TimelineEventCard.tsx` + orders: green/yellow status families (§1d).

`text-gray-*` alone accounts for ~250 usages; `text-red-*` ~140. This is the dominant token-bypass
pattern and the single biggest migration surface.

**PR 1 implication:** Define the clean token set (`:root`/`.dark`/`@theme inline` Shadcn-conventional
+ `font-body`/`font-header` + `info/warning/error/success` fg/bg/border). Do **not** attempt to
repoint all 250 gray usages in PR 1 — that is the job of later slices, which migrate consumers
into the `.theme-new` scope (ADR 2b, amended). PR 1 only needs to (a) establish the scoped token
system and (b) wire the `ThemeMigrationWrapper` so slices can opt in.

---

## 3. Inline components that should use `ui/` primitives

### 3a. Custom avatar bypasses (no) `ui/avatar`

There is no `src/components/ui/avatar.tsx`. `AvatarUser.tsx` reaches directly into
`@radix-ui/react-avatar` and reimplements Root/Image/Fallback with `bg-neo-purple text-white` and
string-concat className. This belongs in `ui-wrappers/` wrapping a generated `ui/avatar.tsx`.

### 3b. Inline `Card` redefinitions (§1c) — should use `ui/card`

`ProductCard`, `CollectionCard`, `products.$productId.tsx` `wrapContent`.

### 3c. Inline status chips — should use `ui/badge` (with a variant) or a `StatusBadge` wrapper

§1d. The `ui/badge.tsx` already has a `cva` variant system (`default/secondary/destructive/outline/ghost/link`)
but no `info/warning/error/success` variants, so callers hand-roll colors.

### 3d. Inline tabs styling overrides `ui/tabs`

`products.$productId.tsx` Tabs: `TabsList` gets `bg-transparent`, `TabsTrigger` gets
`data-[state=active]:bg-secondary data-[state=inactive]:bg-gray-100 ... data-[state=active]:text-white
data-[state=inactive]:text-black`, and the mobile variant renders a manual `bg-secondary ... text-white`
tab header div. These should be `ui-wrappers/` tab styling, not per-route overrides.

### 3e. Inline quantity stepper — should be a shared component

`products.$productId.tsx` builds a `− [Input] +` quantity stepper inline (`Minus`/`Input`/`Plus`
buttons). This is reusable checkout/cart UX and currently has no home.

### 3f. Inline loading spinner — two competing implementations

- `Loader2 className="animate-spin"` (37 files).
- `products.$productId.tsx` uses a hand-rolled `border-4 border-primary border-t-transparent rounded-full w-8 h-8 animate-spin` div.

`ui/spinner.tsx` exists but is barely used. Standardize on one.

### 3g. Inline empty / error / loading full-page states

`products.$productId.tsx` defines three near-identical full-height centered states (loading / error /
not-found / NSFW) with `<h1 className="font-bold text-2xl">` + `<p className="text-gray-600">` +
button row. Similar states recur in `InfiniteProductList`, `community.index.tsx`
(`CollectionsError`/`MerchantsError`), dashboard routes, etc. These should be a shared
`EmptyState`/`ErrorState`/`LoadingState` in `shared/`.

**PR 1 implication:** Most of §3 is slice work, but PR 1 should seed `ui-wrappers/` with at least
one example "Modify" component. Strongest candidates: a `StatusBadge` (variant on `ui/badge`) and/or
an `Avatar` wrapper — both are small, high-frequency, and demonstrate the `ui → ui-wrappers` import
hierarchy.

---

## 4. Repeated layouts and colour schemes

### 4a. The hero layout (§1a) is the dominant repeated layout

`hero-container*` / `hero-content*` / `hero-overlays` + radial/dots overlays, repeated 5×.

### 4b. "Section with `ItemGrid` + title + skeleton/error fallback" layout

`community.index.tsx` renders two `<section>` blocks each wrapping `<ItemGrid title=...>` with
loading (`CollectionSkeletons`/`MerchantSkeletons` — near-identical skeleton markup) / error
(`CollectionsError`/`MerchantsError` — near-identical error block) / empty fallback. This
"grid + states" composition should be a shared `EntityGrid` that owns loading/empty/error.

### 4c. Section title heading pattern duplicated

`<h1 className="text-xl sm:text-2xl font-heading text-center sm:text-left">` is copy-pasted in
`ItemGrid` **and** 3× inside `InfiniteProductList` (loading / empty / loaded branches) — `InfiniteProductList`
reimplements the title rendering instead of delegating to `ItemGrid`.

### 4d. Dark hero on black + pink accent colour scheme

The "black background + `text-white` + `bg-secondary` (pink `#ff3eb5`) accent + `bg-radial-overlay`"
scheme recurs in `Header` (transparent→black), `Footer`, `MobileMenu`, `Hero`, all hero routes. This
is effectively an undocumented "dark hero" theme with no tokens — `--secondary` is pink in light mode
but the hero is always dark, so the pink-on-black pairing is hardcoded rather than tokenized.

**PR 1 implication:** PR 1 doesn't unify these layouts, but the `.theme-new` token system must
define equivalents for `hero-container*`, `hero-content*`, `hero-overlays`, `bg-radial-overlay`,
`bg-dots-overlay`, `bg-header-*` (or accept they stay legacy until the hero slice migrates them
into the new scope as a unit).

---

## 5. Misuse of visual patterns, hooks, components

### 5a. `useHeroBackground` injects global CSS with `!important` from a hook

5 copies (§1a). It creates `<style>` elements appended to `<head>` and uses `!important` to override
`background-image`. This bypasses the entire stylesheet system and is non-SSR-safe (manipulates
`document.head` during render effects). Correct approach: an inline `style` prop or a data-attribute
+ token, never global CSS injection.

### 5b. Business logic trapped in presentational components

53 components call stores/queries inline. Notable:
- `ProductCard` calls `useCart`, `useAuth`, `useQueryClient`, `useLocation`, fires `cartActions`,
  `uiActions`, seeds the query cache — far beyond presentation. ADR 1c wants callbacks.
- `FeaturedUserCard` runs `useQuery` for profile + products inline.
- `UserCard` runs `useProfile` + `useBreakpoint` + clipboard logic + tooltip state inline.
- `PriceDisplay` runs `useBtcExchangeRates` + `useCurrencyConversion` + `uiStore`.
- `Nip05Badge` runs `useProfile` + `nip05ValidationQueryOptions`.
- `AvatarUser` runs `useProfile`.
- `Header`'s `ProfileButton` runs `useProfile` + `useStore(authStore)` + navigation.

ADR 1b permits the `nostr/` directory to use nostr hooks as an **exception** documented in its
`AGENTS.md`. Today there is no `nostr/` directory and no exception doc, so all of this is
un-governed.

### 5c. Sign/publish-with-timeout race trapped in 3 dialog/modal components (§1b)

`Promise.race([signPromise, signTimeoutPromise])` + `Promise.race([publishPromise, publishTimeoutPromise])`
duplicated in `ShareDialog`, `ShareProductDialog`, `BugReportModal`. This is publish-layer logic
(`src/publish/`) leaking into dialogs — violates `src/AGENTS.md` ("Do not hide Nostr protocol rules
inside UI components").

### 5d. `useAutoAnimate` + manual `document.body.style.overflow` side effects

`MobileMenu.tsx` sets `document.body.style.overflow` directly in an effect. Body-scroll-locking is a
cross-cutting concern (also wanted by dialogs/sheets) with no shared hook.

### 5e. Inconsistent className merging

7+ components use string concatenation (`'...' + className` or template literals) instead of `cn()`:
`UserCard`, `AvatarUser`, `Nip05Badge`, `social/CommentButton`, `social/ReactionButton`,
`social/ShareButton`, `social/SocialInteractions`, plus `CartItem`, `WotScore`, `BugReportModal`,
`CollectionCard` (mixed). This defeats Tailwind merge precedence — later `className` props don't
reliably override internal classes.

**PR 1 implication:** PR 1 can't refactor all 53, but the `AGENTS.md` files it creates must
explicitly state the `cn()` + callback requirements (ADR 1c) so slice migrations have a rule to
enforce. The `nostr/` AGENTS.md must document the hooks exception.

---

## 6. Inconsistency in component definitions and usage

### 6a. `forwardRef` vs function components — **DECIDED**

Only 6 of ~125 components use `forwardRef` (`SelectableBadge`, `TooltipButton`, and 4 in `Header`).
The `ui/` primitives use the modern Shadcn function-component style (no `forwardRef`, `React.ComponentProps`).
ADR 1c asks migrated components to forward refs.

**Decision (captured in `src/components/AGENTS.md`):**
- `ui/` Shadcn primitives are left **as-is, no diffs** — do not convert to `forwardRef` or modify.
  They keep the `React.ComponentProps` + `data-slot` style.
- All components authored by us (`ui-wrappers/`, `shared/`, `nostr/`, `layout/`, `dialogs/`, feature
  dirs) **must use `forwardRef`** for consistency.
- The two existing `shared/` components (`SelectableBadge`, `TooltipButton`) are already correct.
- **Forwarding through Shadcn primitives:** rely on the primitives' `{...props}` spread to attach
  `ref` to the root DOM node; do not wrap in an extra element solely for the ref. This avoids React
  dev warnings while keeping wrappers single-element. Restated in per-subdir `AGENTS.md` (e.g.
  `ui-wrappers/AGENTS.md`).

The `ui → ui-wrappers` boundary is where the convention switches: wrappers take `forwardRef` and
adapt around the non-`forwardRef` primitives.

### 6b. Props typing inconsistency

- `ProductCard`: `extends React.HTMLAttributes<HTMLDivElement>` (good).
- `CollectionCard`: `React.HTMLAttributes<'div'>` (string form, inconsistent).
- `UserCard`: custom interface, no `HTMLAttributes` extension, `className?: string` only.
- `FeaturedUserCard`: `extends React.HTMLAttributes<'div'>` but doesn't destructure `className`.
- `PriceDisplay`: custom interface, `className?: string` only, no ref, no variant.
- `AvatarUser`: `extends React.ComponentProps<typeof AvatarPrimitive.Root>` (correct for wrapper).

No two "card-like" components share a props shape.

### 6c. Variant/density conventions absent

`Button` has `cva` variants (`default/destructive/outline/secondary/ghost/link`) + sizes
(`default/xs/sm/lg/icon/icon-xs/icon-sm/icon-lg`). `Badge` has variants but no `info/warning/error/success`.
No component implements a `density`/`compact` prop (ADR 1c mentions it). `UserCard` has a custom
`size: 'xs'|'sm'|'md'|'lg'` — an ad-hoc size variant not shared with anything else.

### 6d. Import convention drift

ADR 1d wants `@/components/{dir}/{component}`. Current usage mixes:
- `@/components/ui/button` ✅
- `./ProductCard` (relative) in `InfiniteProductList` ❌
- `../BugReportModal`, `../shared/TooltipButton` (relative) in `Header` ❌
- `./ui/button`, `./PriceDisplay` (relative) in `ProductCard` ❌

Many intra-`components/` imports are relative rather than alias-based.

### 6e. 36 components at `src/components/` root

`ProductCard`, `CollectionCard`, `UserCard`, `FeaturedUserCard`, `PriceDisplay`, `ImageCarousel`,
`BugReportModal`, `CartItem`, `CartSummary`, `Comments`, `CurrencyDropdown`, `EntityActionsMenu`,
`FeaturedSections`, `Hero`, `ImageViewerModal`, `InfiniteProductList`, `ItemGrid`, `Nip05Badge`,
`PostView`, `ProductDisplayComponent`, `ProductFilters`, `ProductSearch`, `ProfileName`,
`ProfileWalletCheck`, `ShippingSelector`, `UpdateAvailableDialog`, `UserDisplayComponent`,
`UserNameWithBadge`, `WalletSetupGuide`, `WotScore`, `AvatarUser`, `CollectionDisplayComponent`,
`DialogRegistry`, `SheetRegistry`, `Pattern`, `BugReportItem`.

These span nostr-domain (ProductCard, UserCard, Nip05Badge, WotScore, PostView…), shared
(PriceDisplay, CurrencyDropdown, ItemGrid, Pattern…), and layout-adjacent (Hero) concerns with no
classification. Several are near-duplicates of subdirectory siblings (`ProductDisplayComponent` vs
`ProductCard`; `UserDisplayComponent` vs `UserCard`; `CollectionDisplayComponent` vs
`CollectionCard`) — likely **Replace** candidates (ADR 2a).

**PR 1 implication:** PR 1 must create `ui-wrappers/` and `nostr/`, write their `AGENTS.md` files
plus update `src/components/AGENTS.md` to encode the import hierarchy + variant/density/callback
standards, and relocate (or at least plan relocation of) the 36 root components. Relocation can be
done in PR 1 as pure file moves if imports are switched to aliases simultaneously.

---

## 7. Cross-cutting observations for the architecture step

1. **The hero/carousel + `useHeroBackground` is its own vertical.** 5 copies + global CSS injection +
   touch/swipe + auto-slide + pagination. This is the single largest Extract and should probably be
   its own migration slice (the ADR's "PR 3 Home Page" naturally includes it).
2. **UX-state tokens are the highest-ROI foundation addition.** ~250 gray + ~140 red + scattered
   green/blue/amber/yellow/pink usages collapse onto `info/warning/error/success` + `muted-foreground`.
3. **`text-black`-on-`bg-secondary` and `bg-white` dialogs are dark-mode bugs waiting to happen** —
   they assume light mode. Any wrapper that standardizes surface colors fixes a class of bugs.
4. **Shadcn `forwardRef` vs `React.ComponentProps`** — **DECIDED** (see §6a). `ui/` primitives
   left as-is; our components use `forwardRef`; refs forwarded through primitives' `{...props}`
   spread. Captured in `src/components/AGENTS.md`.
5. **`nostr/` hooks exception** needs explicit scope in its AGENTS.md: which hooks are allowed
   (`useProfile`, `useQuery` for nostr events) vs which stay in routes/queries
   (`cartActions`, `uiActions`, `authActions` — arguably callbacks, not inline calls).
6. **Publish/sign-timeout logic** belongs in `src/publish/`, not dialogs — flag for the UX/dialogs
   slice, not PR 1.
7. **Widget-book note:** the duplicated Share dialogs, the 5 hero routes, and the status chips are
   the ideal first widget-book test fixtures — they have clear variants/states and are currently
   untested. PR 2 should prioritize these.

## 8. Theme migration mechanism (replaces `@layer legacy`)

The ADR as written specifies `@layer legacy { ... }` as both (a) a quarantine for old styles and
(b) the migration-progress tracker ("migration is complete when `@layer legacy` is empty"). This
mechanism is not viable in Tailwind v4 and has been abandoned. A working alternative already exists
on branch **`feat/theme-migration`** (commits `507848d1` + `c55fd8d7`, WIP spike). It inverts the
quarantine direction: instead of boxing *old* styles in a legacy layer, it boxes the *new* token
system in a class scope and progressively wraps migrated UI in that scope.

### 8a. The approach (as implemented on `feat/theme-migration`)

1. **A second stylesheet `styles/globals-new.css`** is imported after `styles/globals.css` (via
   `styles/index.css`). It deliberately does **not** redefine `@import 'tailwindcss'`, `@theme`,
   `@layer base`, or `@custom-variant` (those stay in `globals.css` to avoid duplication).
2. **The entire new token system is scoped under a `.theme-new { ... }` class** rather than `:root`.
   This includes `--font-body`/`--font-header` (ADR 1a font rename), semantic colors in **oklch**
   (using the existing custom naming scheme: `primary`/`secondary`/`tertiary`/`focus` +
   `-hover`/`-foreground`/`-border` variants), the **UX-state tokens** (`info`/`warning`/`error`/
   `success`, each with `-foreground`/`-border`/`-muted`), chart colors, and sidebar tokens.
3. **Dark mode is nested coherently** via `& .dark { ... }` inside `.theme-new`, mirroring *all*
   custom variants — fixing the current incoherence where `.dark` omits the custom `-hover`/
   `-border-hover` tokens.
4. **A `ThemeMigrationWrapper` React component** (`src/components/theme-migration/`) renders
   `<div className="theme-new">{children}</div>`. Wrapping a subtree opts it into the new token
   system; unwrapped subtrees keep using the legacy `globals.css` `:root` tokens.
5. **Stylesheet loading** moved from a JS-side `import '../styles/index.css'` in `frontend.tsx` to a
   `<link rel="stylesheet" href="/styles/index.css">` in `index.html` (fixing a Bun bundler
   resolution issue).

As of the spike, `ThemeMigrationWrapper` is imported into `__root.tsx` and `_dashboard-layout.tsx`
but **not yet used in JSX** — i.e. no subtree is actually opted in yet. It is a foundation only.

### 8b. Why this works where `@layer legacy` didn't

- **CSS specificity is DOM-scoped, not layer-scoped** for custom properties: a `.theme-new` class
  on an ancestor redefines `--primary` etc. for that subtree only, so new and old UI can coexist on
  the same page without one clobbering the other. `@layer` cannot achieve per-subtree token
  swapping.
- **Migration progress is structural**, not textual: "which subtrees are wrapped in
  `ThemeMigrationWrapper`" (or, end-state, "is the wrapper wrapping the whole app and can the legacy
  `:root` block be deleted"). This is greppable and reviewable in JSX, arguably more so than a CSS
  block's emptiness.
- **No `!important` arms race**: because new tokens live in their own scope, they don't need to
  override legacy utilities by force; unmigrated components simply don't see the new tokens.

### 8c. ADR amendments applied

The ADR has been amended (this branch) to replace the `@layer legacy` directive with the
`.theme-new` scoped-theme approach. The scope of the change is deliberately narrow: it only swaps
the migration mechanism so that migration can be performed **slice-by-slice**; the ADR's other goals
(token system, font rename, UX-state tokens, directory structure, standardized params, widget book,
classification system) are unchanged. Concretely:

- **§1a (Stylesheet):** Renamed "Scoped Theme + Slice-by-Slice Migration". New token system defined
  under `.theme-new { ... }` in `styles/globals-new.css` (imported after `globals.css`), with
  `& .dark { ... }` for dark mode and `@theme inline` consuming the scoped variables. Legacy
  `globals.css` `:root` tokens remain the default for unmigrated UI. **`oklch` is specified as the
  color standard.** `.theme-new` may scope `@layer base` and `@layer utilities` as well as custom
  properties. Token-system, font-rename (`font-body`/`font-header`), and UX-state-token
  requirements are unchanged.
- **§2b (Component styles migration):** The `@layer legacy` extraction flow is replaced with:
  migrated consumers are wrapped in `ThemeMigrationWrapper` (or the wrapper is moved up the tree to
  cover them); components repoint hardcoded colors to the scoped tokens; when a legacy utility in
  `globals.css` has zero remaining *unwrapped* consumers, it is deleted. Migration is complete when
  `ThemeMigrationWrapper` covers the entire app and the legacy `:root` block + legacy utilities are
  removed from `globals.css`.
- **Consequences:** The `@layer legacy` indicator line is replaced with the `.theme-new` scope +
  `ThemeMigrationWrapper` placement indicator.
- **PR 1 strategy:** PR 1's "Foundation – Styles" deliverable becomes: land `styles/globals-new.css`
  + `ThemeMigrationWrapper` + the `index.css`/`index.html` wiring (all already prototyped on
  `feat/theme-migration`), then create the new component directories and AGENTS.md files. The
  example "Modify" components per subdir (§9) are built *inside* the `.theme-new` scope to validate
  it.

### 8d. Notes / open questions for the architecture step

- The spike keeps the **custom token naming scheme** (`primary`/`secondary`/`tertiary`/`focus` +
  variants) rather than collapsing to bare Shadcn conventions (`primary`/`secondary`/`muted`/
  `accent`). The ADR §1a says "modeled on standard Shadcn conventions" — decide whether to keep the
  richer custom scheme (more tokens, matches existing component usage) or simplify. The handover
  research shows heavy existing reliance on `-foreground-hover`/`-border-hover` variants, so keeping
  them reduces migration churn.
- The spike's `ThemeMigrationWrapper` is a plain `<div>`. Wrapping the app root in a `<div>` can
  affect layout (flex/grid ancestors). Consider whether the wrapper should be applied via a class on
  `<html>`/`<body>` or on the existing root layout container rather than an extra DOM node.
- `oklch` is the **desired color standard** for the new stylesheet (now stated in the ADR §1a),
  not an open question — only the browser-support baseline needs a sanity check (oklch is widely
  supported in current evergreen browsers).
- `.theme-new` **may scope `@layer base` and `@layer utilities` as well** as custom properties (now
  stated in the ADR §1a), so base resets and utility classes defined for the new theme apply only
  within migrated subtrees. The spike scopes only custom properties + nested `.dark`; the amended
  ADR explicitly permits extending this.



## 9. Suggested PR 1 "Modify" example components (one per new subdir)

To satisfy ADR PR 1 ("1+ compliant example component in each subdirectory"), the smallest
demonstrative set:

| Subdir | Example "Modify" component | Demonstrates |
|---|---|---|
| `ui-wrappers/` | `StatusBadge` (cva variant on `ui/badge`: `info/warning/error/success`) | variant system + UX-state tokens + `cn()` + `React.ComponentProps` |
| `ui-wrappers/` | `Avatar` (wraps generated `ui/avatar.tsx`, replaces `AvatarUser`) | `ui → ui-wrappers` import hierarchy + tokenized fallback colors |
| `shared/` | `EmptyState` / `LoadingState` / `ErrorState` | callback-free presentation + `className` merge + `forwardRef`/props decision |
| `nostr/` | `UserCard` (refactored to accept `profile` + `onPress` callback, drop inline `useProfile`) | the documented hooks-exception + callback pattern |
| `layout/` | `IconButton` / `NotificationBadge` (extracted from `Header`) | `shared → layout` hierarchy + tokenized badge colors |
| `dialogs/` | `ShareDialog` (collapsed from 3 copies, publish logic extracted to `src/publish/`) | dialog-shell wrapper + action-via-store exception |

These are recommendations for the architecture step to confirm, not commitments.
