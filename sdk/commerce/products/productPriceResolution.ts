// Pure product-authoring price decisions. Exchange-rate acquisition remains
// supplied by the host application through the converter callback.

export type FiatPriceEditOutcome = {
	price: string
	fiatPrice: string
} | null

export function applyFiatPriceEdit(
	rawValue: string,
	convert: (amount: number, currency: string) => number,
	context: { currency: string; hasExchangeRates: boolean },
): FiatPriceEditOutcome {
	const numValue = parseFloat(rawValue)

	if (!isNaN(numValue) && numValue > 0) {
		if (context.hasExchangeRates) {
			const satsValue = convert(numValue, context.currency)
			if (satsValue > 0) return { price: satsValue.toString(), fiatPrice: rawValue }
		}
		return { price: '', fiatPrice: rawValue }
	}

	if (rawValue === '0') return { price: '0', fiatPrice: '0' }
	if (rawValue === '') return { price: '', fiatPrice: '' }
	return null
}

export type SatsDerivationState = {
	currencyMode: 'sats' | 'fiat'
	fiatPrice: string
	price: string
	currency: string
	hasExchangeRates: boolean
}

export function deriveSatsPriceFromFiat(state: SatsDerivationState, convert: (amount: number, currency: string) => number): string | null {
	if (!state.hasExchangeRates || state.currencyMode !== 'fiat') return null

	const fiatValue = parseFloat(state.fiatPrice)
	if (!(fiatValue > 0)) return null
	if (state.price !== '' && state.price !== '0') return null

	const satsValue = convert(fiatValue, state.currency)
	return satsValue > 0 ? satsValue.toString() : null
}

export type ProductPriceFormState = {
	price: string
	fiatPrice: string
	currency: string
	currencyMode: 'sats' | 'fiat'
	bitcoinUnit: 'SATS' | 'BTC'
}

export type PublishPriceResolution =
	| { status: 'ok'; price: string; currency: string }
	| { status: 'error'; reason: 'missing-fiat-price' | 'unresolved-sats-price' }

function isValidNumberString(value: string): boolean {
	return value.trim().length > 0 && !isNaN(Number(value))
}

export function resolvePublishPrice(state: ProductPriceFormState): PublishPriceResolution {
	if (state.currency === 'SATS' || state.currency === 'BTC') {
		if (!isValidNumberString(state.price)) return { status: 'error', reason: 'unresolved-sats-price' }
		return { status: 'ok', price: convertBitcoinToSatsString(state.price, state.bitcoinUnit), currency: 'SATS' }
	}

	if (state.currencyMode === 'fiat') {
		if (!isValidNumberString(state.fiatPrice)) return { status: 'error', reason: 'missing-fiat-price' }
		return { status: 'ok', price: state.fiatPrice, currency: state.currency }
	}

	if (!isValidNumberString(state.price)) return { status: 'error', reason: 'unresolved-sats-price' }
	return { status: 'ok', price: convertBitcoinToSatsString(state.price, state.bitcoinUnit), currency: 'SATS' }
}

function convertBitcoinToSatsString(price: string, bitcoinUnit: 'SATS' | 'BTC'): string {
	const bitcoinValue = parseFloat(price)
	const satsValue = bitcoinUnit === 'BTC' ? bitcoinValue * 100000000 : bitcoinValue
	return satsValue.toString()
}
