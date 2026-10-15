/**
 * instance/cartState.ts — the browser's cart, held through the SDK's cart surface.
 *
 * The cart belongs to the **browser**, not to the instance. `sdk/commerce/cart`
 * ships the contract for that and deliberately no storage:
 *
 * - `parseCartPersistenceContent(content)` — the SDK's own parser, which refuses
 *   a record that does not match `PersistedCartContentSchema`, so a record this
 *   module did not write is not silently trusted;
 * - `CART_PERSISTENCE_VERSION` — the version the storage key is scoped by;
 * - `createCartIntent` / `addCartProduct` — the SDK's own builder and mutation:
 *   the builder turns buyer-facing entries into the persisted record (refs,
 *   clamped integer quantities, deduped and sorted) and the mutation decides what
 *   adding a product that is already in the cart means.
 *
 * What the SDK does not ship is the front of the pipe: a place to put the bytes.
 * Supplying storage is the host's job (ADR-0021, "the SDK owns contracts and the
 * Platform owns per-instance values"), so it is an **injected port** here —
 * `CartStorage` — and nothing in this module reaches for `window`. The browser
 * adapter is the last export in the file and is the only thing that touches a
 * global; a test drives the same logic with a two-line fake.
 *
 * No commerce rule is re-stated here. The ref's shape, the quantity clamp, the
 * dedupe and the "is this record valid" decision all come from the SDK; this
 * module maps between the SDK's persisted record and the line the page renders,
 * and counts.
 */

import { CART_PERSISTENCE_VERSION, addCartProduct, createCartIntent, parseCartPersistenceContent } from '@sdk/commerce/cart'

import type { ProductListItem } from './productListView'

/** Where this instance keeps its cart. Instance-scoped: one shop's cart is not another's. */
export const CART_STORAGE_KEY = `demo-shop.cart.v${CART_PERSISTENCE_VERSION}`

/** The front of the pipe. `read` returning `null` means "nothing is stored yet". */
export interface CartStorage {
	read(): string | null
	write(value: string): void
}

/** One line as the page shows it: the SDK's ref, plus the parts of it a row needs. */
export interface CartLine {
	/** The SDK's `30402:<seller>:<d>` ref, exactly as persisted. */
	readonly productRef: string
	/** The listing's `d` tag, split back out of the ref by the SDK's own format. */
	readonly id: string
	readonly sellerPubkey: string
	readonly amount: number
}

export interface Cart {
	readonly lines: readonly CartLine[]
}

export const EMPTY_CART: Cart = { lines: [] }

/**
 * Split the SDK's product ref back into its parts.
 *
 * `sdk/commerce/cart/cartIntent.ts` builds the ref as `30402:<64-hex>:<d>` and
 * validates it with `/^30402:[a-f0-9]{64}:[^\s]+$/i`, so the split is the SDK's
 * format read backwards and not a second definition of it. The `d` is taken as
 * everything after the second colon, because a `d` may legally contain one.
 */
export function splitProductRef(productRef: string): { id: string; sellerPubkey: string } | null {
	const first = productRef.indexOf(':')
	const second = productRef.indexOf(':', first + 1)
	if (first === -1 || second === -1) return null
	return { sellerPubkey: productRef.slice(first + 1, second), id: productRef.slice(second + 1) }
}

/**
 * Read the browser's cart.
 *
 * A record the SDK's parser refuses is **not** repaired and not guessed at: the
 * read answers the empty cart, which is the only answer this module can honestly
 * give for bytes nobody vouches for.
 */
export function readCart(storage: CartStorage): Cart {
	const stored = storage.read()
	if (stored === null) return EMPTY_CART

	const parsed = parseCartPersistenceContent(stored)
	if (!parsed) return EMPTY_CART

	const lines: CartLine[] = []
	for (const item of parsed.items) {
		const parts = splitProductRef(item.productRef)
		if (!parts) continue
		lines.push({
			productRef: item.productRef,
			id: parts.id,
			sellerPubkey: parts.sellerPubkey,
			amount: item.quantity,
		})
	}

	return { lines }
}

/** How many items the cart holds. Quantities are the SDK's clamped integers, so this sums. */
export function cartCount(cart: Cart): number {
	return cart.lines.reduce((total, line) => total + line.amount, 0)
}

/**
 * The line a listing becomes when it is put in the cart: the SDK's own
 * `productRef` identity, plus the parts a row needs to render.
 */
export function cartLineFrom(item: ProductListItem, amount: number): CartLine {
	return { productRef: item.coordinates, id: item.id, sellerPubkey: item.sellerPubkey, amount }
}

/**
 * Fold a listing into the cart, through the SDK's own mutation.
 *
 * `addCartProduct` decides what "adding a product that is already there" means —
 * it increments, and it clamps — so nothing here re-states that. It is handed a
 * map keyed by the listing's `d`, which is the key the cart's own refs and the
 * app's product addresses agree on.
 */
export function addLineToCart(cart: Cart, line: CartLine): Cart {
	const map: Record<string, CartLine> = {}
	for (const existing of cart.lines) map[existing.id] = existing

	const after = addCartProduct(map, line)
	// `addCartProduct` answers with the same object when it changed nothing, so
	// "no change" is a reference the caller can trust rather than a diff.
	if (after === map) return cart
	return { lines: Object.values(after) }
}

/**
 * Write the cart, through the SDK's builder.
 *
 * `createCartIntent` is given the lines and the clock the caller owns, and its
 * answer — not this module's idea of what the bytes should be — is what lands in
 * storage. A line the builder drops (a ref it refuses) therefore cannot reach the
 * store at all.
 */
export function writeCart(storage: CartStorage, cart: Cart, updatedAtMs: number): void {
	storage.write(JSON.stringify(createCartIntent(cart.lines, updatedAtMs)))
}

/**
 * The browser adapter — the only place in this module that touches a global.
 *
 * `null` when there is no `localStorage` (a server render, or a browser that
 * refuses storage), which the callers read as "no cart is reachable here"
 * rather than as an empty one. The probe is a *capability* check: Safari in
 * private mode exposes `localStorage` and throws on write, so a read-only port
 * is still not enough to call storage usable.
 */
export function browserCartStorage(): CartStorage | null {
	if (typeof window === 'undefined') return null
	try {
		const store = window.localStorage
		const probe = `${CART_STORAGE_KEY}.probe`
		store.setItem(probe, '1')
		store.removeItem(probe)
		return {
			read: () => store.getItem(CART_STORAGE_KEY),
			write: (value) => store.setItem(CART_STORAGE_KEY, value),
		}
	} catch {
		return null
	}
}
