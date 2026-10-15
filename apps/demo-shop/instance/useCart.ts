/**
 * instance/useCart.ts — the browser's cart as the page sees it, and the one way
 * a surface puts something in it.
 *
 * The page is **server-rendered**, and the server cannot know this browser's
 * cart: it is the browser's own storage. So the hook has an explicit
 * not-yet-read state and the surface renders the same thing on the server as on
 * the client's first render — the skeleton — with the real answer arriving in an
 * effect after hydration. That is what keeps the two renders identical (React
 * hydrates rather than re-creates) and what makes the skeleton an honest loading
 * state instead of a guess at `0`.
 *
 * The three states are named, because a surface that renders one of them must be
 * able to say which. An eternal skeleton for "this browser refuses storage" would
 * be the same defect as printing a `0` nobody measured.
 *
 * `add` is the app's whole write path, and every step of it is the SDK's:
 * `addLineToCart` folds the product in through `addCartProduct`, and `writeCart`
 * persists the builder's own answer. The only thing this hook decides is *when*
 * — after the read has landed, so an add cannot race the load and overwrite the
 * cart that was already there.
 */

import * as React from 'react'

import {
	addLineToCart,
	browserCartStorage,
	cartCount,
	readCart,
	writeCart,
	type Cart,
	type CartLine,
	type CartStorage,
} from './cartState'

/** What the page knows about the browser's cart. */
export type CartStatus = 'reading' | 'unavailable' | 'read'

export interface CartControl {
	/** `reading` on the server and on the client's first render, then `read` or `unavailable`. */
	readonly status: CartStatus
	/** `null` until the read has landed. Never a guessed `0`. */
	readonly count: number | null
	/** `null` until the read has landed. */
	readonly cart: Cart | null
	/**
	 * Put a listing in the cart and persist it.
	 *
	 * Refuses, and says so, in the two cases the hook can name: the read has not
	 * landed yet, and this browser has no reachable storage. Returns the count it
	 * now holds, or `null` when it refused — so the surface can put the refusal
	 * into its own words instead of showing a stale number.
	 */
	add(line: CartLine): number | null
}

/** The clock the write stamps, injected so nothing here reaches for a global. */
export interface CartOptions {
	readonly storage?: () => CartStorage | null
	readonly now?: () => number
}

export function useCart(options: CartOptions = {}): CartControl {
	const storageOf = options.storage ?? browserCartStorage
	const now = options.now ?? (() => Date.now())

	const [status, setStatus] = React.useState<CartStatus>('reading')
	const [cart, setCart] = React.useState<Cart | null>(null)

	React.useEffect(() => {
		const storage = storageOf()
		if (storage === null) {
			setStatus('unavailable')
			return
		}
		setCart(readCart(storage))
		setStatus('read')
	}, [storageOf])

	const add = React.useCallback(
		(line: CartLine): number | null => {
			const storage = storageOf()
			if (storage === null) {
				setStatus('unavailable')
				return null
			}

			// The read's own answer is the base, so an add can never resurrect a
			// cart the browser had already emptied.
			const base = cart ?? readCart(storage)
			const next = addLineToCart(base, line)
			if (next === base) return cartCount(base)

			try {
				writeCart(storage, next, now())
			} catch {
				// Storage that refuses the write leaves the cart as it was: the
				// surface reports the refusal rather than a cart it did not save.
				return null
			}

			setCart(next)
			setStatus('read')
			return cartCount(next)
		},
		[cart, now, storageOf],
	)

	return { status, count: cart === null ? null : cartCount(cart), cart, add }
}
