import { describe, expect, test } from 'bun:test'
import { MempoolService } from '@/lib/utils/mempool'

describe('currency conversion helpers', () => {
	test('converts sats to fiat using BTC as the pivot currency', () => {
		const exchangeRates = {
			USD: 100_000,
			EUR: 90_000,
		} as Record<string, number>

		expect(MempoolService.convertSatsToCurrency({ sats: 50_000_000, targetCurrency: 'USD', exchangeRates })).toBe(50_000)
		expect(MempoolService.convertSatsToCurrency({ sats: 100_000_000, targetCurrency: 'EUR', exchangeRates })).toBe(90_000)
	})

	test('converts fiat values back to sats', () => {
		const exchangeRates = {
			USD: 100_000,
		} as Record<string, number>

		expect(MempoolService.convertCurrencyToSats({ amount: 50_000, fromCurrency: 'USD', exchangeRates })).toBe(50_000_000)
		expect(MempoolService.convertCurrencyToSats({ amount: 25, fromCurrency: 'USD', exchangeRates })).toBe(25_000)
	})

	test('supports direct conversion between currencies through BTC', () => {
		const exchangeRates = {
			USD: 100_000,
			EUR: 90_000,
		} as Record<string, number>

		expect(MempoolService.convertBetweenCurrencies({ amount: 50_000, fromCurrency: 'USD', toCurrency: 'EUR', exchangeRates })).toBe(45_000)
	})

	test('handles BTC and SATS directly without extra branching', () => {
		const exchangeRates = {
			USD: 100_000,
		} as Record<string, number>

		expect(MempoolService.convertCurrencyToSats({ amount: 1, fromCurrency: 'BTC', exchangeRates })).toBe(100_000_000)
		expect(MempoolService.convertCurrencyToSats({ amount: 5_000, fromCurrency: 'SATS', exchangeRates })).toBe(5_000)
		expect(MempoolService.convertBetweenCurrencies({ amount: 1, fromCurrency: 'BTC', toCurrency: 'USD', exchangeRates })).toBe(100_000)
	})
})
