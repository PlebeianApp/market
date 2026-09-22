/**
 * `@plebeian/browse-ui` — the browsing components.
 *
 * The contract, stated once so every component can be checked against it:
 *
 *   - **Data in, markup out.** No fetching, no validating, no store, no router.
 *   - **A validated value, never a raw event.** `ProductCard` takes a `ProductListing`.
 *   - **One environment argument** for the few things a component cannot do itself: resolve media,
 *     read config, open a link.
 *   - **Size-agnostic.** Every surface is a container query, tested from 200×160 up.
 *
 * That is what makes the same file render in our app, in the CMS editor and in a sandboxed frame.
 */
export { Media, type MediaProps } from './Media'
export { PriceDisplay, formatPrice, type PriceDisplayProps } from './PriceDisplay'
export { ProductCard, type ProductCardProps } from './ProductCard'
export { ProductGrid, type ProductGridProps } from './ProductGrid'
export {
	EmptyState,
	LoadingState,
	NSFWBadge,
	ProblemList,
	StockBadge,
	SurfaceStateView,
	UnavailableState,
	type SurfaceState,
} from './states'
