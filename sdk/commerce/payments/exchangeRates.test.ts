import { describe, expect, test } from 'bun:test'
import {
	convertFiatToSats,
	isConvertibleAmount,
	isSatsCurrency,
	readContextVmBtcRates,
	readYadioBtcRates,
	selectExchangeRate,
} from './exchangeRates'

describe('exchangeRates', () => {
	test('reads ContextVM rates only when present and error-free', () => {
		expect(readContextVmBtcRates({ rates: { USD: 50000 } })).toEqual({ USD: 50000 })
		expect(readContextVmBtcRates({ rates: { USD: 1 }, error: 'boom' })).toBeNull()
		expect(readContextVmBtcRates({})).toBeNull()
		expect(readContextVmBtcRates(null)).toBeNull()
	})

	test('reads the Yadio BTC table', () => {
		expect(readYadioBtcRates({ BTC: { EUR: 40000 } })).toEqual({ EUR: 40000 })
		expect(() => readYadioBtcRates(null as never)).toThrow()
	})

	test('selects a rate or throws when missing or zero', () => {
		expect(selectExchangeRate({ USD: 50000 }, 'USD')).toBe(50000)
		expect(() => selectExchangeRate({ USD: 0 }, 'USD')).toThrow('Exchange rate not available for USD')
		expect(() => selectExchangeRate(null, 'USD')).toThrow()
	})

	test('guards tiny, zero and currency-less amounts', () => {
		expect(isConvertibleAmount('USD', 1)).toBe(true)
		expect(isConvertibleAmount('USD', 0.0001)).toBe(false)
		expect(isConvertibleAmount('USD', 0)).toBe(false)
		expect(isConvertibleAmount('USD', -5)).toBe(false)
		expect(isConvertibleAmount('', 10)).toBe(false)
	})

	test('recognizes sats and converts fiat without rounding', () => {
		expect(isSatsCurrency('SATS')).toBe(true)
		expect(isSatsCurrency('sat')).toBe(true)
		expect(isSatsCurrency('BTC')).toBe(false)
		expect(convertFiatToSats(2, 1)).toBe(200000000)
		expect(convertFiatToSats(1, 30000)).toBe((1 / 30000) * 100000000)
	})
})
