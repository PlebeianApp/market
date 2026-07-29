# ADR Proposal: Strip product-specific logic out of the V4V UI (Audit + single-PR plan)

**Status:** Proposed — research complete, awaiting approval to implement
**Branch:** `audit/v4v-ui-agnostic` (worktree `wt-v4v-ui-audit`), based off **`master`**
**Date:** 2026-07-30
**Scope:** A single PR. No new UI component; the existing `V4VManager` is made agnostic by **inversion of control** — product-specific behavior is extracted into helper/utility/query files and injected back at the call site (the dashboard parent route).
**References:**

- Foundation philosophy: `franchovy/pr1/foundation-styles-review-fixes` → `docs/adr/ADR-component-ui-migration-and-widget-book.md` (UI-layer/business-logic separation; callbacks for actions instead of in-file hooks; `forwardRef`; `cn()`; clean up custom UI). We **follow the philosophy** but do **not** branch from that PR and do **not** adopt its new directory structure (`ui-wrappers/`, `nostr/`, `shared/`, `theme-migration/`) — those don't exist on `master`.
- Auction intent: `felixfelix-bot/feat/v4v-dev-splits-implementation` → `docs/adr/proposals/v4v-dev-splits-auction.md` + `adr-v4v-dev-splits-DECISIONS.md`. That ADR is valid; its implementation was rejected. This PR does **not** implement auctions — it only makes the V4V UI reusable _so that_ auctions can adopt it later without further UI changes.

---

## 1. Goal

Make the existing `V4VManager` UI **agnostic to how it is used** so it can be reused for multiple purposes (Auctions being the next one), by stripping the product-specific (i.e. sales-specific) functionality out of the component and into appropriate helper/utility/query files, and having the **dashboard parent route** declare that this instance is "for all products" by passing in the sales hooks/handlers/labels it already uses today.

Design intent: the **only** consumer-visible change to `V4VManager` is that it stops fetching/saving/deciding what "V4V" means and instead receives that from props. Its rendered output is otherwise preserved (behavior-identical for sales).

## 2. Decisions applied (from the request)

1. **Base on `master`** — the worktree `wt-v4v-ui-audit` is already on `audit/v4v-ui-agnostic` off `master` (`9da1c855`).
2. **Follow the philosophy of the UI-migration PR, not its branch.** We apply: no business logic in the presentational component, callbacks for actions instead of in-file hooks, `forwardRef`, `cn()` className merging, and a measured cleanup of custom/hardcoded UI. We do **not** create `ui-wrappers/`, `nostr/`, `shared/`, or `.theme-new` — those are the foundation PR's deliverables and would conflict if we pre-empted them here.
3. **Single PR.** One cohesive change; no multi-PR sequence.
4. **No new UI component.** We keep `V4VManager.tsx` (and `ProfileSearch`/`RecipientItem`/`RecipientPreview`) in place; we make it agnostic by extracting product-specific logic out, not by replacing it.
5. **The route owns the "how".** The dashboard parent route (`circular-economy.tsx`) — and the `V4VSetupDialog` — compose the sales-specific hooks/handlers/labels and pass them into `V4VManager`. That call site is what says "this view is specifically for all products".

## 3. Current state recap (why it is not reusable today)

- `V4VManager.tsx` calls `useV4VManager` **internally** and renders sales-specific copy/visualization: a "PM (Beta) Is Powered By Your Generosity…" `Alert`, an emoji wiggle/shake/glow widget keyed off the total %, "Split of total sales" / "V4V split between recipients" headings, a two-bar seller-vs-V4V viz, hardcoded colors (`bg-fuchsia-500`, `bg-green-600`, `bg-rose-500`, `bg-blue-100`, `text-blue-800`, …), and imports a sales-route CSS file (`…/sales/emoji-animations.css`) directly into the component.
- `useV4VManager.ts` is the sales "brain": local share state, fraction normalization math, the **app-npub default recipient** seeding, the emoji computations, and the **persistence path** (`usePublishV4VShares` → Nostr kind 30078 `l: v4v_share`, with each recipient scaled by `totalV4VPercentage/100` on save).
- `ProfileSearch.tsx` and `RecipientItem.tsx` call nostr hooks inline (`useQuery`/NIP-50 search, `useZapCapabilityInfo`). These are Nostr-domain, not product-specific — they stay. (They _would_ move to `nostr/` under the foundation PR; out of scope here to avoid conflicts.)
- Two consumers (`circular-economy.tsx` route and `V4VSetupDialog.tsx`) **duplicate** the same "normalize stored shares into initialShares + initialTotalPercentage" logic.
- `V4VDTO` (`{ id, name, pubkey, percentage }`) lives in `src/lib/stores/cart.ts` and is imported across cart/orders/products/V4V. **Not moved** in this PR (minimal change; not blocking agnosticism — the component will accept `V4VDTO[]` as props). Left as a noted follow-up.
- `queries/v4v.tsx` already holds the sales data layer (`useV4VShares`, `publishV4VShares`, `usePublishV4VShares`, config-state enum). It stays as the sales query/persistence layer; no UI coupling added.

## 4. What is "product-specific" (the extraction targets)

These are the sales-V4V concerns that must leave `V4VManager` (and where they go):

| Product-specific concern                                                                           | Today                                              | Moves to                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share math: normalize to sum=1, add/remove/update/equalize, scale-by-total                         | inline in `useV4VManager`                          | **`src/lib/v4v/splits.ts`** (pure, unit-tested, reusable by auctions)                                                                                            |
| Persistence: save kind 30078, scale recipients by total %                                          | `useV4VManager.saveShares` → `usePublishV4VShares` | stays in **`src/queries/v4v.tsx`**; the _composition_ (scale + publish) is owned by the sales hook the route uses                                                |
| App-npub default recipient seeding                                                                 | `useV4VManager` init effect                        | the **sales hook** (kept in `src/hooks/`) — an auction hook would seed validators instead                                                                        |
| Emoji wiggle/shake/glow + 🤙/🎁/💩 values                                                          | `useV4VManager` computed                           | a small **`src/lib/v4v/emoji.ts`** pure helper OR keep in the sales hook and pass as data; component renders it only when `config.showEmoji`                     |
| All copy ("PM Beta…", "Split of total sales", "V4V split between recipients", button text, alerts) | hardcoded in `V4VManager`                          | a **`labels` prop** supplied by the route (sales labels)                                                                                                         |
| Sales viz: total-% slider, seller-vs-V4V two-bar, recipient split bar                              | always rendered                                    | gated behind **`config` props** (`showTotalSlider`, `showSellerBar`, `showEmoji`); sales route enables them                                                      |
| Zap-capability gating (refuse recipients who can't receive zaps)                                   | baked into add-recipient + `RecipientItem`         | a **`requireZapCapable` config flag** from the route (sales: true; auctions: false — donations redeem via locked e-cash notes, not zaps)                         |
| `emoji-animations.css` import                                                                      | imported in the component                          | moved to the **sales route** (it's a sales viz concern)                                                                                                          |
| Hardcoded colors                                                                                   | throughout V4V files                               | cleaned up to existing shadcn semantic tokens (`bg-primary`, `text-muted-foreground`, `border`, etc.) where low-risk — no `.theme-new` (doesn't exist on master) |

## 5. Target architecture (inversion of control)

```
                       ┌─────────────────────────────────────────┐
   sales route /       │  composes the SALES "how":              │
   V4VSetupDialog  ───▶│  useSalesV4VSplits (the current hook), │
   (the call site)     │  sales labels, sales config,            │
                       │  sales persistence (queries/v4v)       │
                       └───────────────────┬─────────────────────┘
                                           │ props: state + handlers + labels + config
                                           ▼
                       ┌─────────────────────────────────────────┐
                       │  V4VManager  (PRESENTATIONAL, AGNOSTIC) │
                       │  - no @/queries, no @/hooks, no publish  │
                       │  - forwardRef + cn(className)            │
                       │  - renders only what config/labels say   │
                       └───────────────────┬─────────────────────┘
                                           │ renders
                                           ▼
                       ProfileSearch / RecipientItem / RecipientPreview
                       (Nostr-domain sub-components, unchanged location)
```

Tomorrow, an **auction** route would compose an `useAuctionV4VSplits` hook (bps unit, total 10000, seller = read-only remainder, validator seeds from kind 30409, `requireZapCapable: false`, `showEmoji: false`, `showTotalSlider: false`, auction labels, persistence to kind 30408) and render the **same** `<V4VManager>`. That consumer is **not** built in this PR — it is the proof of agnosticism.

### 5.1 `V4VManager` props (new contract)

The component stops importing `useV4VManager` and `V4VDTO`-only-as-source. It accepts:

```ts
// src/components/v4v/V4VManager.tsx
export interface V4VManagerProps {
	// --- data (injected by the route's hook) ---
	shares: V4VDTO[] // current recipients
	totalV4VPercentage: number // sales concept; auctions pass 100 (of bpsTotal) or ignore
	newRecipientNpub: string
	newRecipientShare: number
	showAddForm: boolean
	canReceiveZaps?: boolean | undefined
	isCheckingZap: boolean
	isChecking: boolean
	isSaving: boolean // publishMutation.isPending
	hasChanges?: boolean

	// --- computed viz values (injected; sales hook computes emoji, auctions pass null) ---
	sellerPercentage?: number
	formattedSellerPercentage?: string
	formattedTotalV4V?: string
	recipientColors?: Record<string, string>
	emoji?: string
	emojiSize?: number
	emojiClass?: string

	// --- handlers (callbacks, not in-file hooks) ---
	onTotalV4VPercentageChange: (v: number[]) => void
	onProfileSelect: (npub: string) => void
	onAddRecipient: () => void
	onRemoveRecipient: (id: string) => void
	onUpdatePercentage: (id: string, pct: number) => void
	onEqualizeAll: () => void
	onSetNewRecipientShare: (v: number) => void
	onToggleAddForm: (open: boolean) => void
	onSave: () => Promise<void> | void
	onCancel?: () => void

	// --- "how" declared by the call site ---
	labels: V4VLabels // all copy: alert, headings, button text, empty state
	config: V4VConfig // feature flags: showEmoji, showTotalSlider, showSellerBar,
	//   showSaveButton, showCancelButton, requireZapCapable,
	//   saveButtonTestId, showChangesIndicator
	className?: string // cn()-merged, forwarded
}
```

`V4VLabels` and `V4VConfig` are small interfaces co-located with the component (or in `src/lib/v4v/`). This is the "standardized params" discipline from the foundation ADR (callbacks for actions; `className` via `cn()`).

### 5.2 The sales hook stays as the sales adapter

`src/hooks/useV4VManager.ts` remains the **sales-specific** hook (renamed conceptually to "sales V4V adapter" but we keep the file name to minimize churn). Changes:

- Delegate all share math to `src/lib/v4v/splits.ts`.
- Keep the app-npub default-recipient seeding, the emoji computation, and the save path (scale-by-total + `usePublishV4VShares`) — these are the sales "how".
- Return the same surface it returns today (state + handlers + computed), so the route just spreads it into `<V4VManager>`.

### 5.3 The route declares "all products"

`src/routes/_dashboard-layout/dashboard/sales/circular-economy.tsx` becomes the place that says "this is the sales/products view":

```tsx
function CircularEconomyComponent() {
	// ... existing auth + useV4VShares + normalization (de-duplicated, see §6) ...
	const sales = useV4VManager({ userPubkey, initialShares, initialTotalPercentage, onSaveSuccess })

	return (
		<V4VManager
			{...sales} // state + handlers + computed
			labels={salesV4VLabels} // sales copy
			config={{
				showEmoji: true,
				showTotalSlider: true,
				showSellerBar: true,
				requireZapCapable: true,
				showSaveButton: true,
				saveButtonTestId: 'save-v4v-button',
			}}
			className="..."
		/>
	)
}
```

`V4VSetupDialog.tsx` is updated analogously (and its duplicated normalization is removed — see §6). Both call sites now make the product-specific choice; the component does not.

## 6. Single-PR file list

**New files**

- `src/lib/v4v/splits.ts` — pure share math extracted from `useV4VManager`: `normalizeShares`, `addRecipient`, `removeRecipient`, `updatePercentage`, `equalizeAll`, `scaleSharesByTotal`. Pure, no React, no nostr. Reusable by a future auction hook.
- `src/lib/v4v/labels.ts` (or co-located types) — `V4VLabels` / `V4VConfig` interfaces, and `salesV4VLabels` default (the PM-generosity copy etc.).
- `src/lib/v4v/__tests__/splits.test.ts` (or `src/lib/__tests__/v4v-splits.test.ts` to match existing test dir) — unit tests for the extracted math.
- _(Optional, only if emoji extraction is cleaner)_ `src/lib/v4v/emoji.ts` — `getEmojiState(totalPct) → { emoji, emojiSize, emojiClass }`. If small enough, keep in the sales hook instead; decide during implementation.

**Modified files**

- `src/components/v4v/V4VManager.tsx` — remove `useV4VManager` import + `emoji-animations.css` import; accept the new props (§5.1); gate all sales-only rendering behind `config`; pull all copy from `labels`; add `forwardRef` + `cn()`; clean hardcoded colors to shadcn tokens where low-risk. Behavior preserved for sales.
- `src/hooks/useV4VManager.ts` — delegate math to `src/lib/v4v/splits.ts`; otherwise keep as the sales adapter (same return surface).
- `src/routes/_dashboard-layout/dashboard/sales/circular-economy.tsx` — call `useV4VManager`, build `salesV4VLabels` + sales `config`, import `emoji-animations.css` here, render `<V4VManager {...sales} labels config />`. Remove the duplicated normalize block (move into a tiny shared helper, see next).
- `src/components/dialogs/V4VSetupDialog.tsx` — same wiring as the route; remove its duplicated normalize logic by reusing the shared normalize helper.
- `src/components/orders/detail/V4VRecipientsCard.tsx` — minor: token-color cleanup only (it's already pure/presentational); no contract change. _(Only if it stays low-risk; otherwise defer.)_
- A shared normalization helper for "stored shares → { initialShares, initialTotalPercentage }" (currently duplicated in the route and the dialog). Place in `src/lib/v4v/splits.ts` as `deriveInitialSharesFromStored(stored)` and use in both consumers.

**Not touched (deliberate — minimal change / avoid conflicts with foundation PR)**

- `src/components/v4v/ProfileSearch.tsx`, `RecipientItem.tsx`, `RecipientPreview.tsx` — stay in `v4v/` (not moved to `nostr/`); their inline nostr hooks remain (Nostr-domain, allowed exception under the foundation ADR; relocation is the foundation PR's job).
- `V4VDTO` in `src/lib/stores/cart.ts` — not relocated (rename blast radius is large and not required for agnosticism; the component accepts `V4VDTO[]` as props). Noted follow-up.
- `src/queries/v4v.tsx` — no UI coupling added; stays the sales data layer.
- No new component directories (`ui-wrappers/`, `nostr/`, `shared/`), no `.theme-new`, no `ThemeMigrationWrapper` — those are the foundation PR.

## 7. How this follows the foundation philosophy (mapping)

| Foundation ADR principle                           | How this PR applies it (on master)                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No business logic in presentational components     | `V4VManager` no longer owns state/persistence/defaults; receives state + handlers via props                                   |
| Callbacks for actions instead of in-file hooks     | All actions are `on*` props; `useV4VManager` is called by the route, not the component                                        |
| `forwardRef` to root element                       | added to `V4VManager`                                                                                                         |
| `cn()` className merging                           | `className` prop merged via `cn()`                                                                                            |
| Clean up custom UI / hardcoded colors              | measured pass to existing shadcn tokens (no `.theme-new` — absent on master)                                                  |
| Standardized params (variants/feature flags)       | `config` flags gate sales-only rendering; `labels` externalize copy                                                           |
| Components may only import below them in hierarchy | `V4VManager` imports only `ui/` primitives + `v4v/` siblings + types; **no** `@/queries`, `@/hooks`, `@/lib/stores/*` actions |

## 8. Proof of agnosticism (auction reuse, not built now)

To confirm the PR achieves reuse, the plan includes a **non-implemented sketch** (in the ADR doc, not code) of an auction consumer:

```tsx
// HYPOTHETICAL — not in this PR
function AuctionSplitsSection() {
	const auction = useAuctionV4VSplits({ auctionEventId, sellerNpub }) // kind 30408 read + 30409 validators
	return (
		<V4VManager
			{...auction} // shares (bps, total 10000), handlers, no emoji
			labels={auctionV4VLabels} // "V4V Splits", validator/V4V copy
			config={{ showEmoji: false, showTotalSlider: false, showSellerBar: true, requireZapCapable: false, showSaveButton: true }}
		/>
	)
}
```

This works iff `V4VManager` makes no assumption about unit, persistence kind, default recipients, or copy — which is exactly what this PR enforces. The auction _adapter + persistence + schema_ (kind 30408/30409, ADR-0002-compliant Nostr I/O) is a **separate, future** effort that consumes the now-agnostic UI unchanged.

## 9. Tests

- **Unit:** `src/lib/v4v/__tests__/splits.test.ts` — normalize, add/remove/update/equalize, scale-by-total, `deriveInitialSharesFromStored`, sum-invariant enforcement. Port the meaningful assertions from the existing math and from felix's `auction-splits-arithmetic.test.ts` (pure math only).
- **Behavior gate:** existing `e2e/tests/v4v-product-creation.spec.ts` must remain green — this PR is behavior-identical for sales. Run before declaring done.
- No new e2e for auctions (out of scope).

## 10. Risks & open questions

1. **Prop surface grows.** Inversion of control means `V4VManager` gains ~25 props. This is the intended trade-off for agnosticism without a new component. Acceptable per the request; keep the prop grouping (data / handlers / labels / config) clear with JSDoc.
2. **Emoji extraction.** Decide during implementation whether emoji state is a tiny pure helper (`src/lib/v4v/emoji.ts`) or stays as computed values returned by the sales hook and passed through. Either keeps the component agnostic (it only renders `emoji`/`emojiClass`/`emojiSize` when `config.showEmoji`).
3. **Color cleanup risk.** Mapping hardcoded colors to shadcn tokens on master (without `.theme-new`) is a visual judgment call; keep it conservative and reversible. If any mapping is contentious, defer that specific color to keep the PR focused.
4. **`V4VRecipientsCard`.** Optional touch; if it risks scope creep, defer to a follow-up. It is already presentational and doesn't block the main goal.
5. **Naming.** We keep the `useV4VManager` filename to minimize churn even though it is now conceptually the _sales_ adapter. Acceptable? (Alternative: rename to `useSalesV4VManager`; adds churn.)
6. **Future auction unit.** `V4VManager` currently thinks in "percentage of total" with a separate total slider. Auctions use bps with seller = remainder and no total knob. The `config` flags handle the UI differences; a future auction adapter supplies `totalV4VPercentage`-equivalents (or the prop set is adjusted slightly then). This PR does not need to finalize the bps plumbing — only ensure no sales assumption is hardcoded. Flag for the auction PR.

## 11. Out of scope (explicit)

- Implementing the auction adapter / kind 30408 / 30409 / validator queries (that's the next effort; this PR unblocks it).
- Migrating sales `queries/v4v.tsx` off NDK to applesauce (ADR-0002) — separate migration.
- Moving `V4VDTO` out of `cart.ts`, relocating `ProfileSearch`/`RecipientItem` to `nostr/`, adopting `.theme-new` / `ThemeMigrationWrapper` / new dirs — all foundation-PR concerns.
- Validator consensus, bidder WOT, bid bonds, settlement-window fallback (deferred per the V4V ADR's own list).

## 12. Next step

On approval, implement the single PR described in §6 on this worktree (`audit/v4v-ui-agnostic` off `master`): extract `src/lib/v4v/splits.ts` + tests, invert `V4VManager` to props/labels/config, wire `circular-economy.tsx` and `V4VSetupDialog.tsx` to inject the sales "how", and keep `v4v-product-creation.spec.ts` green.
