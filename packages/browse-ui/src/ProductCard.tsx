/**
 * `ProductCard` — the worked example of the component contract.
 *
 * What it takes: **a validated listing and an environment.** Not an event, not a store, not a query.
 * It cannot fetch (there is no fetch in this file), cannot validate (the listing is already valid) and
 * cannot decide whether it should be shown (that is the gate's job).
 *
 * What it does do, and the spec requires: render the NSFW badge whenever the item is NSFW, show the
 * stock state, name anything the parser could not read, and offer links to the two things a card must
 * always reach — the listing itself and its seller (browsing spec §1.1).
 */
import type { ParseProblem, ProductListing } from '@plebeian/product-event'
import type { BrowseEnvironment } from '@plebeian/nostr-access'

import { Media } from './Media'
import { PriceDisplay } from './PriceDisplay'
import { NSFWBadge, ProblemList, StockBadge } from './states'

export interface ProductCardProps {
	listing: ProductListing
	env: BrowseEnvironment
	/** Anything the parser tolerated and the surface may want to disclose. */
	problems?: readonly ParseProblem[]
	onOpenListing?: (coordinate: string) => void
	onOpenSeller?: (pubkey: string) => void
}

export const ProductCard = ({ listing, env, problems = [], onOpenListing, onOpenSeller }: ProductCardProps) => {
	const cover = listing.images[0]?.url

	return (
		<article className="pb-card" data-coordinate={listing.coordinate} data-nsfw={listing.nsfw}>
			<Media src={cover} alt={listing.title} env={env} />
			<div className="pb-card__body">
				<h3 className="pb-card__title">
					{onOpenListing ? (
						<button type="button" className="pb-card__title-link" onClick={() => onOpenListing(listing.coordinate)}>
							{listing.title}
						</button>
					) : (
						listing.title
					)}
				</h3>

				{listing.summary ? <p className="pb-card__summary">{listing.summary}</p> : null}

				<PriceDisplay price={listing.price} />

				<div className="pb-card__footer">
					<div>
						{listing.nsfw ? <NSFWBadge /> : null} <StockBadge inStock={listing.inStock} preorder={listing.visibility === 'pre-order'} />
					</div>
					{onOpenSeller ? (
						<button type="button" className="pb-card__seller" onClick={() => onOpenSeller(listing.pubkey)}>
							{listing.pubkey.slice(0, 8)}…
						</button>
					) : null}
				</div>

				<ProblemList problems={problems} />
			</div>
		</article>
	)
}
