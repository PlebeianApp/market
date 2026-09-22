/**
 * `@plebeian/browse-filter` — the viewer's filter and sort state, applied purely.
 *
 * What belongs here: choices the *viewer* makes about what to see, and the ordering of what they
 * see. Extracted from `src/components/ProductFilters.tsx:10-30` (the state) and the streaming path
 * in `src/hooks/useStreamingProducts.ts:73-96` (the behaviour), so the three hosts cannot drift.
 *
 * What deliberately does NOT belong here:
 *   - **Gating.** Hidden items, blacklists, test labels, deletions and NSFW are *withholding* rules,
 *     not viewer preferences. They are the surface's job (browsing spec §3.3) and belong in a gate,
 *     not in a filter. Putting them here is exactly how the current implementation ended up filtering
 *     NSFW in one place out of four.
 *   - **Derived stock semantics.** Whether a listing is in stock was decided at parse time by
 *     `@plebeian/product-event`; this package only reads `inStock`.
 */
import type { ProductListing } from '@plebeian/product-event'

export type SortOption = 'newest' | 'oldest' | 'a-z' | 'z-a'

export interface ProductFilterState {
	showOutOfStock: boolean
	hidePreorder: boolean
	sort: SortOption
	/** A substring matched against the listing's `location`; empty means no country filter. */
	country: string
}

/** Defaults preserved from the application (`src/components/ProductFilters.tsx:25-30`). */
export const defaultProductFilters: ProductFilterState = {
	showOutOfStock: false,
	hidePreorder: false,
	sort: 'newest',
	country: '',
}

/** True when the state differs from the defaults — used to show a "filters active" affordance. */
export const hasActiveFilters = (state: ProductFilterState): boolean =>
	state.showOutOfStock || state.hidePreorder || state.sort !== 'newest' || state.country.trim() !== ''

const compare =
	(sort: SortOption) =>
	(a: ProductListing, b: ProductListing): number => {
		switch (sort) {
			case 'newest':
				return b.createdAt - a.createdAt
			case 'oldest':
				return a.createdAt - b.createdAt
			case 'a-z':
				return a.title.localeCompare(b.title)
			case 'z-a':
				return b.title.localeCompare(a.title)
		}
	}

/**
 * Apply the viewer's preferences to already-validated listings.
 *
 * Pure and total: it never drops a listing for a reason the viewer did not ask for, and it never
 * sorts non-deterministically. Equal items keep their input order (a stable sort), so two adapters
 * given the same fixtures produce byte-identical output — which is the cross-adapter invariant the
 * spec requires (browsing spec §9).
 */
export const applyFilterState = (
	listings: readonly ProductListing[],
	state: ProductFilterState = defaultProductFilters,
): ProductListing[] => {
	const country = state.country.trim().toLowerCase()

	const visible = listings.filter((listing) => {
		if (!state.showOutOfStock && !listing.inStock) return false
		if (state.hidePreorder && listing.visibility === 'pre-order') return false
		if (country && !(listing.location ?? '').toLowerCase().includes(country)) return false
		return true
	})

	// Decorate with the input index so the sort is stable and deterministic across engines.
	return visible
		.map((listing, index) => ({ listing, index }))
		.sort((a, b) => {
			const byState = compare(state.sort)(a.listing, b.listing)
			return byState !== 0 ? byState : a.index - b.index
		})
		.map((entry) => entry.listing)
}

/**
 * A short summary of how the viewer has departed from the defaults — for a "filters active" label.
 *
 * Deliberately consistent with `hasActiveFilters`: it describes *deviations*, not the state's literal
 * content. Reporting "out-of-stock hidden" at the defaults would be true but useless, and would make
 * two functions disagree about whether anything is applied.
 */
export const describeFilterState = (state: ProductFilterState): string => {
	const parts: string[] = []
	if (state.hidePreorder) parts.push('pre-orders hidden')
	if (state.showOutOfStock) parts.push('out-of-stock shown')
	if (state.country.trim()) parts.push(`country: ${state.country.trim()}`)
	if (state.sort !== 'newest') parts.push(`sorted ${state.sort}`)
	return parts.length ? parts.join(' · ') : 'no filters'
}
