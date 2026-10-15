/**
 * instance/useCart.ts — the browser's cart as the page sees it.
 *
 * The page is **server-rendered**, and the server cannot know this browser's
 * cart: it is the browser's own storage. So the hook has an explicit
 * not-yet-read state and the surface renders the same thing on the server as on
 * the client's first render — the skeleton — with the real answer arriving in an
 * effect after hydration. That is what keeps the two renders identical (React
 * hydrates rather than re-creates) and what makes the skeleton an honest
 * loading state instead of a guess at `0`.
 *
 * The three states are named, because a surface that renders one of them must be
 * able to say which. Rendering an eternal skeleton for "this browser refuses
 * storage" would be the same defect as printing a `0` nobody measured.
 */

import * as React from 'react'

import { browserCartStorage, cartCount, readCart } from './cartState'

export type CartCount =
	/** The browser has not been asked yet — the server render, and the first client render. */
	| { readonly state: 'reading' }
	/** This browser has no reachable cart storage. A named state, never an empty cart. */
	| { readonly state: 'unavailable' }
	| { readonly state: 'read'; readonly count: number }

export function useCartCount(): CartCount {
	const [status, setStatus] = React.useState<CartCount>({ state: 'reading' })

	React.useEffect(() => {
		const storage = browserCartStorage()
		setStatus(storage === null ? { state: 'unavailable' } : { state: 'read', count: cartCount(readCart(storage)) })
	}, [])

	return status
}
