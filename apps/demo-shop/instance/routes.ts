/**
 * instance/routes.ts — the app's addresses, spelled in one place.
 *
 * The rule this file exists for: **the address a page emits and the address the
 * router serves must be one string, not two spellings of one idea.** A surface
 * that builds a link and a server that parses a path can each be individually
 * plausible and still disagree, and the failure shows up as a link that navigates
 * to a page which resolves nothing.
 *
 * One consequence is worth stating, because it is the one that bites: a parent
 * route's prefix check **swallows its children**. `/products/` is a prefix of
 * every product address, and a branch that matched the prefix alone would answer
 * the list for a detail request; so parsing returns the *remainder* and the caller
 * decides, and a path that is exactly the prefix resolves to no listing.
 */

/** The list path. */
export const PRODUCTS_PATH = '/'

/** The cart's page. A full page load, like every other route here. */
export const CART_PATH = '/cart'

/** The checkout entry. The payment itself is not built; this is where it would land. */
export const CHECKOUT_PATH = '/checkout'

/** Every listing's page lives under this prefix. */
export const PRODUCT_PATH_PREFIX = '/products/'

/**
 * A listing's address: its **coordinates**, which is what the SDK's head rule and
 * product identity already use (`30402:<seller pubkey>:<d tag>`, per
 * `getProductCoordinates`). No id is invented and no coordinate is re-spelled:
 * the `d` alone would be ambiguous across sellers the moment there are two.
 */
export function productPath(coordinates: string): string {
	return `${PRODUCT_PATH_PREFIX}${coordinates}`
}

/**
 * The coordinates in a product address, or `null` when the path is not one.
 *
 * `null` is a decision, not an absence: the caller renders the 404 for it, rather
 * than falling through to another surface's page.
 */
export function coordinatesFromProductPath(pathname: string): string | null {
	if (!pathname.startsWith(PRODUCT_PATH_PREFIX)) return null
	const coordinates = decodeURIComponent(pathname.slice(PRODUCT_PATH_PREFIX.length))
	return coordinates.length > 0 ? coordinates : null
}

/** The JSON twin of the listing list. It is what `curl` is pointed at. */
export const API_PRODUCTS_PATH = '/api/products'

/** The JSON twin of one listing's page: the same coordinates, under the API prefix. */
export function apiCoordinatesFromProductPath(pathname: string): string | null {
	if (!pathname.startsWith(`${API_PRODUCTS_PATH}/`)) return null
	const coordinates = decodeURIComponent(pathname.slice(API_PRODUCTS_PATH.length + 1))
	return coordinates.length > 0 ? coordinates : null
}

/**
 * Is this path a **page** this app serves?
 *
 * Exact for the fixed pages and parsed for a listing's address, because a prefix
 * check alone answers `/cart` and `/products/<coordinates>` with the list — the
 * parent-route-swallows-its-child defect. The server and the test that reads the
 * links the UI emits both ask this one function, so "the nav's hrefs all resolve"
 * is a claim about the router rather than about a copy of it.
 */
export function isPagePath(pathname: string): boolean {
	return (
		pathname === PRODUCTS_PATH ||
		pathname === CART_PATH ||
		pathname === CHECKOUT_PATH ||
		coordinatesFromProductPath(pathname) !== null
	)
}
