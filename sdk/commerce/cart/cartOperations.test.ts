import { describe, expect, test } from 'bun:test'
import {
	addCartProduct,
	aggregateBuyerCartTotals,
	aggregateCartDisplayTotals,
	groupCartProductsBySeller,
	normalizeCartQuantity,
	removeCartProduct,
	setCartProductQuantity,
	updateCartProductQuantity,
} from './cartOperations'
import { currencyPrecision, minorUnitSum, UndeclaredCurrencyPrecisionError } from './money'
import type { CartProductEntry } from './cartOperations'

const sellerA = 'a'.repeat(64)
const sellerB = 'b'.repeat(64)
const product = (id: string, amount: number, sellerPubkey = sellerA) => ({ id, amount, sellerPubkey })

describe('cart product operations', () => {
	test('normalizes finite quantities to integer bounds and rejects non-finite values', () => {
		expect(normalizeCartQuantity(2.9)).toBe(2)
		expect(normalizeCartQuantity(-1)).toBe(0)
		expect(normalizeCartQuantity(1000)).toBe(999)
		expect(normalizeCartQuantity(Number.NaN)).toBeNull()
		expect(normalizeCartQuantity(Number.POSITIVE_INFINITY)).toBeNull()
	})

	test('adds products and caps accumulated quantity without replacing existing product fields', () => {
		const first = { ...product('coat', 2), shippingMethodId: 'ship-1' }
		const added = addCartProduct({ coat: first }, { ...product('coat', 3), shippingMethodId: 'ship-2' })
		expect(added.coat).toEqual({ ...first, amount: 5 })
		expect(addCartProduct(added, product('coat', 2000)).coat?.amount).toBe(999)
		const capped = addCartProduct(added, product('coat', 2000))
		expect(addCartProduct(capped, product('coat', 1))).toBe(capped)
		expect(addCartProduct(added, product('other', 0))).toBe(added)
	})

	test('sets quantity, decrements, removes at zero and ignores invalid quantity', () => {
		const cart = { coat: product('coat', 2), hat: product('hat', 1) }
		expect(setCartProductQuantity(cart, 'coat', 4.8).coat?.amount).toBe(4)
		expect(setCartProductQuantity(cart, 'coat', Number.NaN)).toBe(cart)
		expect(updateCartProductQuantity(cart, 'coat', 'decrement').coat?.amount).toBe(1)
		expect(updateCartProductQuantity(cart, 'hat', 'decrement').hat).toBeUndefined()
		expect(removeCartProduct(cart, 'coat').coat).toBeUndefined()
		expect(removeCartProduct(cart, 'missing')).toBe(cart)
	})

	test('groups products by valid seller pubkey', () => {
		const grouped = groupCartProductsBySeller({
			one: product('one', 1, sellerA),
			two: product('two', 2, sellerA),
			three: product('three', 1, sellerB),
			invalid: product('invalid', 1, 'bad-pubkey'),
		})
		expect(grouped[sellerA]?.map((entry) => entry.id)).toEqual(['one', 'two'])
		expect(grouped[sellerB]?.map((entry) => entry.id)).toEqual(['three'])
		expect(Object.keys(grouped)).not.toContain('bad-pubkey')
	})

	/**
	 * The availability rule that the demo's surface carried before this
	 * increment: an out-of-stock listing is refused by the SDK itself.
	 *
	 * **The mutation that turns it red:** remove the `inStock === false`
	 * check from `addCartProduct`. The product is then added regardless
	 * of stock status and the test expects it to be present.
	 */
	test('an out-of-stock listing is refused by the SDK function itself', () => {
		const cart = { coat: product('coat', 2) }
		const unchanged = addCartProduct(cart, { id: 'scarf', amount: 1, sellerPubkey: sellerA, inStock: false } as CartProductEntry)
		expect(unchanged).toBe(cart)
		expect(unchanged.scarf).toBeUndefined()
	})
})

describe('cart total aggregation', () => {
	const lines = [
		{ subtotalInSats: 100, shippingInSats: 10, subtotalInCurrency: 5, shippingInCurrency: 1, currency: 'USD' },
		{ subtotalInSats: 200, shippingInSats: 20, subtotalInCurrency: 6, shippingInCurrency: 2, currency: 'USD' },
		{ subtotalInSats: 300, shippingInSats: 0, subtotalInCurrency: 7, shippingInCurrency: 0, currency: 'EUR' },
	]

	test('aggregates buyer totals and per-currency sums from resolved line values', () => {
		expect(aggregateBuyerCartTotals(lines)).toEqual({
			subtotalInSats: 600,
			shippingInSats: 30,
			totalInSats: 630,
			currencyTotals: {
				USD: { subtotal: 11, shipping: 3, total: 14 },
				EUR: { subtotal: 7, shipping: 0, total: 7 },
			},
		})
	})

	test('aggregates display totals using seller shipping sats as current store does', () => {
		expect(aggregateCartDisplayTotals(lines, [30.4, -2, Number.NaN])).toEqual({
			totalInSats: 630,
			totalShippingInSats: 30,
			subtotalByCurrency: { USD: 11, EUR: 7 },
			shippingByCurrency: { USD: 3 },
			totalByCurrency: { USD: 14, EUR: 7 },
		})
	})

	/**
	 * The case the increment exists for, with its premise measured first so the
	 * premise itself cannot quietly stop being true.
	 *
	 * **The mutation that turns this red:** sum `subtotalInCurrency` with `+` on the
	 * raw numbers — what this function did before the increment — and the two
	 * amounts add up as binary floats to `0.00030000000000000003`.
	 */
	test('the binary-float case is exact: 0.0001 + 0.0002 is 0.0003', () => {
		expect(0.0001 + 0.0002).not.toBe(0.0003)
		expect(String(0.0001 + 0.0002)).toBe('0.00030000000000000003')

		const btcLines = [
			{ subtotalInSats: 0, shippingInSats: 0, subtotalInCurrency: 0.0001, shippingInCurrency: 0, currency: 'BTC' },
			{ subtotalInSats: 0, shippingInSats: 0, subtotalInCurrency: 0.0002, shippingInCurrency: 0, currency: 'BTC' },
		]

		expect(aggregateCartDisplayTotals(btcLines, []).subtotalByCurrency.BTC).toBe(0.0003)
		expect(aggregateCartDisplayTotals(btcLines, []).totalByCurrency.BTC).toBe(0.0003)
		expect(aggregateBuyerCartTotals(btcLines).currencyTotals.BTC?.subtotal).toBe(0.0003)
		expect(aggregateBuyerCartTotals(btcLines).currencyTotals.BTC?.total).toBe(0.0003)
	})

	test('a currency with no declared precision is refused by name, never assumed', () => {
		expect(currencyPrecision('BTC')).toBe(8)
		expect(currencyPrecision('SAT')).toBe(0)
		expect(currencyPrecision('USD')).toBe(2)
		expect(currencyPrecision('XBT')).toBeNull()

		expect(() => minorUnitSum('XBT')).toThrow(UndeclaredCurrencyPrecisionError)
		expect(() =>
			aggregateCartDisplayTotals(
				[{ subtotalInSats: 0, shippingInSats: 0, subtotalInCurrency: 1, shippingInCurrency: 0, currency: 'XBT' }],
				[],
			),
		).toThrow(UndeclaredCurrencyPrecisionError)
		expect(() =>
			aggregateBuyerCartTotals([
				{ subtotalInSats: 0, shippingInSats: 0, subtotalInCurrency: 1, shippingInCurrency: 0, currency: 'XBT' },
			]),
		).toThrow(UndeclaredCurrencyPrecisionError)
	})
})
