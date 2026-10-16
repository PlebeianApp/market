import { describe, expect, test } from 'bun:test'
import { resolvePriceDisplay } from './priceDisplay'

describe('resolvePriceDisplay', () => {
	test('sats listings show the viewer currency as the secondary price', () => {
		expect(
			resolvePriceDisplay({ priceValue: 50_000, originalCurrency: 'sats', selectedCurrency: 'USD', exchangeRates: { USD: 100_000 } }),
		).toEqual({
			isBitcoinCurrency: true,
			satsValue: 50_000,
			fiatValue: { value: 50, currency: 'USD' },
		})
	})

	test('BTC listings convert to sats', () => {
		expect(resolvePriceDisplay({ priceValue: 0.001, originalCurrency: 'BTC', selectedCurrency: 'USD' }).satsValue).toBe(100_000)
	})

	test('fiat listings use the host conversion and stay in their own currency', () => {
		const price = resolvePriceDisplay({
			priceValue: 20,
			originalCurrency: 'EUR',
			selectedCurrency: 'USD',
			exchangeRates: { EUR: 100_000, USD: 110_000 },
			satsFromFiat: 20_000,
		})
		expect(price).toEqual({ isBitcoinCurrency: false, satsValue: 20_000, fiatValue: { value: 20, currency: 'EUR' } })
	})

	test('missing rates or conversion leave the derived values empty', () => {
		expect(resolvePriceDisplay({ priceValue: 20, originalCurrency: 'EUR', selectedCurrency: 'USD' })).toEqual({
			isBitcoinCurrency: false,
			satsValue: null,
			fiatValue: null,
		})
	})
})
