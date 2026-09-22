/**
 * `ProductGrid` — a surface, not a component: it owns the viewer's filters and the gate.
 *
 * The two rules it enforces, both of which the current application gets wrong somewhere:
 *
 *   1. **Fail closed.** It renders no items until `state.status === 'ready'`. In the application the
 *      blacklist and label gates return *everything* while unloaded, so the first paint of every feed
 *      is unfiltered (`src/lib/utils/blacklistFilters.ts:10-12`); here that window does not exist.
 *   2. **One NSFW rule.** The viewer's preference is applied in exactly one place — here — rather than
 *      in one list component out of four (`src/components/InfiniteProductList.tsx:82`).
 *
 * The grid is a container query, so the same markup works at 200×160 and at 2400×1200.
 */
import { useMemo } from 'react'

import type { ProductListing } from '@plebeian/product-event'
import type { BrowseEnvironment } from '@plebeian/nostr-access'
import {
	applyFilterState,
	defaultProductFilters,
	describeFilterState,
	hasActiveFilters,
	type ProductFilterState,
} from '@plebeian/browse-filter'

import { ProductCard } from './ProductCard'
import { SurfaceStateView, type SurfaceState } from './states'

export interface ProductGridProps {
	listings: readonly ProductListing[]
	env: BrowseEnvironment
	state: SurfaceState
	filters?: ProductFilterState
	/** The viewer's NSFW preference, resolved by the host before render. */
	showNSFW: boolean
	onOpenListing?: (coordinate: string) => void
	onOpenSeller?: (pubkey: string) => void
	/** Problems per listing coordinate, for disclosure. */
	problemsByCoordinate?: ReadonlyMap<string, readonly import('@plebeian/product-event').ParseProblem[]>
}

export const ProductGrid = ({
	listings,
	env,
	state,
	filters = defaultProductFilters,
	showNSFW,
	onOpenListing,
	onOpenSeller,
	problemsByCoordinate,
}: ProductGridProps) => {
	const visible = useMemo(() => {
		// The NSFW rule first, then the viewer's own filters — one place, one order.
		const allowed = showNSFW ? listings : listings.filter((listing) => !listing.nsfw)
		return applyFilterState(allowed, filters)
	}, [listings, filters, showNSFW])

	const hiddenForNSFW = showNSFW ? 0 : listings.filter((listing) => listing.nsfw).length

	return (
		<div className="plebeian-browse">
			<div className="pb-toolbar">
				<span className="pb-toolbar__count" data-testid="grid-count">
					{state.status === 'ready' ? `${visible.length} shown` : '—'}
				</span>
				{hasActiveFilters(filters) ? <span className="pb-toolbar__count">{describeFilterState(filters)}</span> : null}
				{hiddenForNSFW > 0 ? (
					<span className="pb-toolbar__count" data-testid="nsfw-hidden">
						{hiddenForNSFW} hidden (NSFW)
					</span>
				) : null}
			</div>

			{/* Fail closed: nothing renders below this line unless the gate says ready. */}
			<SurfaceStateView state={state}>
				{visible.length === 0 ? (
					<div className="pb-state">
						<span className="pb-state__title">Nothing matches</span>
						<span>The listings loaded, and none of them pass the current filters.</span>
					</div>
				) : (
					<ul className="pb-grid" data-testid="product-grid">
						{visible.map((listing) => (
							<li key={listing.coordinate}>
								<ProductCard
									listing={listing}
									env={env}
									problems={problemsByCoordinate?.get(listing.coordinate) ?? []}
									onOpenListing={onOpenListing}
									onOpenSeller={onOpenSeller}
								/>
							</li>
						))}
					</ul>
				)}
			</SurfaceStateView>
		</div>
	)
}
