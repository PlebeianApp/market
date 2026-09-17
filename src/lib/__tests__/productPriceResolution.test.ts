import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock the publish layer before importing the product form store so
// continuePublishing can be asserted without relay/network side effects.
mock.module('@/publish/products', () => ({
	publishProduct: mock(async () => 'test-published-event-id'),
	updateProduct: mock(async () => 'test-updated-event-id'),
}))

import { publishProduct } from '@/publish/products'
import { productFormActions } from '@/lib/stores/product'
import { applyFiatPriceEdit, deriveSatsPriceFromFiat, resolvePublishPrice } from '@/lib/utils/productPriceResolution'

// Deterministic converter for tests: 1 unit of currency = 100_000 sats.
// Like the real converter, it returns 0 for currencies it has no rate for.
const convertUsdLike = (amount: number, currency: string) => (currency === 'USD' ? amount * 100_000 : 0)

const publishMock = publishProduct as ReturnType<typeof mock>

describe('applyFiatPriceEdit', () => {
	test('derives the sats price while exchange rates are available', () => {
		expect(applyFiatPriceEdit('25', convertUsdLike, { currency: 'USD', hasExchangeRates: true })).toEqual({
			price: '2500000',
			fiatPrice: '25',
		})
	})

	test('keeps the fiat edit and leaves the sats price unresolved while rates are unavailable', () => {
		// Regression: convertCurrencyToSats returns 0 without rates; the old
		// code stored that 0 as the price, which publication carried as a
		// real SATS price.
		expect(applyFiatPriceEdit('25', convertUsdLike, { currency: 'USD', hasExchangeRates: false })).toEqual({
			price: '',
			fiatPrice: '25',
		})
	})

	test('leaves the sats price unresolved when no rate exists for the currency', () => {
		expect(applyFiatPriceEdit('25', convertUsdLike, { currency: 'EUR', hasExchangeRates: true })).toEqual({
			price: '',
			fiatPrice: '25',
		})
	})

	test('keeps an explicit zero as an intentional free price', () => {
		expect(applyFiatPriceEdit('0', convertUsdLike, { currency: 'USD', hasExchangeRates: true })).toEqual({
			price: '0',
			fiatPrice: '0',
		})
	})

	test('clears both prices when the fiat input is cleared', () => {
		expect(applyFiatPriceEdit('', convertUsdLike, { currency: 'USD', hasExchangeRates: true })).toEqual({
			price: '',
			fiatPrice: '',
		})
	})

	test('keeps previous store values for partial input', () => {
		expect(applyFiatPriceEdit('-', convertUsdLike, { currency: 'USD', hasExchangeRates: true })).toBeNull()
		expect(applyFiatPriceEdit('abc', convertUsdLike, { currency: 'USD', hasExchangeRates: true })).toBeNull()
	})
})

describe('deriveSatsPriceFromFiat (rates-unavailable -> rates-arrive transition)', () => {
	test('derives the sats price once rates arrive after an edit made without rates', () => {
		// 1. Merchant edits the fiat price while rates are unavailable.
		const edited = applyFiatPriceEdit('25', convertUsdLike, { currency: 'USD', hasExchangeRates: false })
		expect(edited).toEqual({ price: '', fiatPrice: '25' })

		// 2. Rates arrive: the derivation effect resolves the sats price.
		const derived = deriveSatsPriceFromFiat(
			{
				currencyMode: 'fiat',
				fiatPrice: edited!.fiatPrice,
				price: edited!.price,
				currency: 'USD',
				hasExchangeRates: true,
			},
			convertUsdLike,
		)
		expect(derived).toBe('2500000')

		// 3. Sats-fixed publication now succeeds with the resolved price.
		expect(
			resolvePublishPrice({
				price: derived ?? '',
				fiatPrice: edited!.fiatPrice,
				currency: 'USD',
				currencyMode: 'sats',
				bitcoinUnit: 'SATS',
			}),
		).toEqual({ status: 'ok', price: '2500000', currency: 'SATS' })
	})

	test('does not derive while rates are still unavailable', () => {
		expect(
			deriveSatsPriceFromFiat(
				{ currencyMode: 'fiat', fiatPrice: '25', price: '', currency: 'USD', hasExchangeRates: false },
				convertUsdLike,
			),
		).toBeNull()
	})

	test('does not overwrite an already resolved sats price', () => {
		expect(
			deriveSatsPriceFromFiat(
				{ currencyMode: 'fiat', fiatPrice: '25', price: '2500000', currency: 'USD', hasExchangeRates: true },
				convertUsdLike,
			),
		).toBeNull()
	})

	test('repairs a stale 0-derived sats price from older drafts once rates arrive', () => {
		// '0' is truthy, so a plain !price guard would never repair these.
		expect(
			deriveSatsPriceFromFiat(
				{ currencyMode: 'fiat', fiatPrice: '25', price: '0', currency: 'USD', hasExchangeRates: true },
				convertUsdLike,
			),
		).toBe('2500000')
	})

	test('keeps an explicit zero free price (no repair when fiat is zero)', () => {
		expect(
			deriveSatsPriceFromFiat(
				{ currencyMode: 'fiat', fiatPrice: '0', price: '0', currency: 'USD', hasExchangeRates: true },
				convertUsdLike,
			),
		).toBeNull()
	})

	test('does not derive in sats-fixed mode', () => {
		expect(
			deriveSatsPriceFromFiat(
				{ currencyMode: 'sats', fiatPrice: '25', price: '', currency: 'USD', hasExchangeRates: true },
				convertUsdLike,
			),
		).toBeNull()
	})
})

describe('resolvePublishPrice (publication boundary)', () => {
	test('sats-fixed mode fails closed while the derived sats price is unresolved', () => {
		// Regression: the old continuePublishing coerced the unresolved price
		// to 0 via parseFloat(state.price || '0') and published a free product.
		expect(resolvePublishPrice({ price: '', fiatPrice: '25', currency: 'USD', currencyMode: 'sats', bitcoinUnit: 'SATS' })).toEqual({
			status: 'error',
			reason: 'unresolved-sats-price',
		})
	})

	test('sats-fixed mode publishes the resolved sats price', () => {
		expect(
			resolvePublishPrice({
				price: '2500000',
				fiatPrice: '25',
				currency: 'USD',
				currencyMode: 'sats',
				bitcoinUnit: 'SATS',
			}),
		).toEqual({ status: 'ok', price: '2500000', currency: 'SATS' })
	})

	test('fiat-fixed mode publishes the explicit fiat value while sats is unresolved', () => {
		expect(resolvePublishPrice({ price: '', fiatPrice: '25', currency: 'USD', currencyMode: 'fiat', bitcoinUnit: 'SATS' })).toEqual({
			status: 'ok',
			price: '25',
			currency: 'USD',
		})
	})

	test('fiat-fixed mode fails closed without an explicit fiat price', () => {
		expect(resolvePublishPrice({ price: '2500000', fiatPrice: '', currency: 'USD', currencyMode: 'fiat', bitcoinUnit: 'SATS' })).toEqual({
			status: 'error',
			reason: 'missing-fiat-price',
		})
	})

	test('bitcoin currencies publish in SATS', () => {
		expect(resolvePublishPrice({ price: '10000', fiatPrice: '', currency: 'SATS', currencyMode: 'sats', bitcoinUnit: 'SATS' })).toEqual({
			status: 'ok',
			price: '10000',
			currency: 'SATS',
		})
	})

	test('bitcoin currency with BTC unit converts to SATS', () => {
		expect(resolvePublishPrice({ price: '0.0001', fiatPrice: '', currency: 'BTC', currencyMode: 'sats', bitcoinUnit: 'BTC' })).toEqual({
			status: 'ok',
			price: (0.0001 * 100000000).toString(),
			currency: 'SATS',
		})
	})

	test('bitcoin currency fails closed while the sats price is unresolved', () => {
		expect(resolvePublishPrice({ price: '', fiatPrice: '', currency: 'SATS', currencyMode: 'sats', bitcoinUnit: 'SATS' })).toEqual({
			status: 'error',
			reason: 'unresolved-sats-price',
		})
	})

	test('non-numeric prices fail closed', () => {
		expect(resolvePublishPrice({ price: 'abc', fiatPrice: '', currency: 'SATS', currencyMode: 'sats', bitcoinUnit: 'SATS' }).status).toBe(
			'error',
		)
		expect(resolvePublishPrice({ price: '', fiatPrice: 'abc', currency: 'USD', currencyMode: 'fiat', bitcoinUnit: 'SATS' }).status).toBe(
			'error',
		)
	})
})

describe('productFormActions.continuePublishing price boundary', () => {
	const signer = {} as Parameters<typeof productFormActions.continuePublishing>[0]
	const ndk = {} as Parameters<typeof productFormActions.continuePublishing>[1]

	beforeEach(() => {
		productFormActions.reset()
		publishMock.mockClear()

		productFormActions.updateValues({
			name: 'Test product',
			description: 'A test product',
			quantity: '10',
		})
	})

	test('fails closed without publishing when the sats price is unresolved', async () => {
		productFormActions.updateValues({
			currency: 'USD',
			currencyMode: 'sats',
			price: '', // derived sats unresolved: fiat edited while rates were unavailable
			fiatPrice: '25',
		})

		const result = await productFormActions.continuePublishing(signer, ndk)

		expect(result).toBe(false)
		expect(publishMock.mock.calls.length).toBe(0)
	})

	test('publishes the explicit fiat value in fiat mode while sats is unresolved', async () => {
		productFormActions.updateValues({
			currency: 'USD',
			currencyMode: 'fiat',
			price: '', // rates never arrived, derived sats unresolved
			fiatPrice: '25',
		})

		const result = await productFormActions.continuePublishing(signer, ndk)

		expect(result).toBe('test-published-event-id')
		expect(publishMock.mock.calls.length).toBe(1)
		const formData = publishMock.mock.calls[0][0] as { price: string; currency: string }
		expect(formData.price).toBe('25')
		expect(formData.currency).toBe('USD')
	})

	test('publishes the resolved sats price in sats mode', async () => {
		productFormActions.updateValues({
			currency: 'USD',
			currencyMode: 'sats',
			price: '2500000',
			fiatPrice: '25',
		})

		const result = await productFormActions.continuePublishing(signer, ndk)

		expect(result).toBe('test-published-event-id')
		const formData = publishMock.mock.calls[0][0] as { price: string; currency: string }
		expect(formData.price).toBe('2500000')
		expect(formData.currency).toBe('SATS')
	})
})
