// Pure price-derivation and publication-price resolution helpers for the
// product form's dual fiat/sats price fields.
//
// Exchange-rate availability is unpredictable: the form's converters return 0
// when rates are missing, so every decision that turns a fiat amount into a
// sats amount (or publishes either) must be guarded here to avoid storing or
// publishing a 0-derived price. The sats price is "unresolved" while it cannot
// be derived; an empty string is the canonical unresolved marker.

export type FiatPriceEditOutcome = {
	price: string
	fiatPrice: string
} | null

/**
 * Applies a fiat price edit to the form state.
 *
 * While exchange rates are available the sats price is derived alongside the
 * edited fiat value. While they are unavailable the edited fiat value is
 * preserved and the derived sats price is left unresolved ('') so it can be
 * derived later, when rates arrive (see deriveSatsPriceFromFiat) — instead of
 * storing a 0-derived placeholder that publication would carry as a real
 * price.
 *
 * Returns null for partial input (e.g. '-', '1e') where the previous store
 * values should be kept.
 */
export function applyFiatPriceEdit(
	rawValue: string,
	convert: (amount: number, currency: string) => number,
	context: { currency: string; hasExchangeRates: boolean },
): FiatPriceEditOutcome {
	const numValue = parseFloat(rawValue)

	if (!isNaN(numValue) && numValue > 0) {
		if (context.hasExchangeRates) {
			const satsValue = convert(numValue, context.currency)
			if (satsValue > 0) {
				return { price: satsValue.toString(), fiatPrice: rawValue }
			}
		}
		// Rates unavailable (or no rate for this currency): keep the fiat edit,
		// leave the sats price unresolved.
		return { price: '', fiatPrice: rawValue }
	}

	if (rawValue === '0') {
		// Explicit zero: the merchant priced the product at zero on purpose.
		return { price: '0', fiatPrice: '0' }
	}

	if (rawValue === '') {
		return { price: '', fiatPrice: '' }
	}

	return null
}

export type SatsDerivationState = {
	currencyMode: 'sats' | 'fiat'
	fiatPrice: string
	price: string
	currency: string
	hasExchangeRates: boolean
}

/**
 * Derives the sats price from the fiat price once exchange rates are
 * available (fiat-fixed mode only).
 *
 * The sats price counts as unresolved while empty, or while it is '0' next to
 * a positive fiat price — a stale 0-derived value written by older builds
 * whose converters returned 0 while rates were unavailable. '0' is truthy, so
 * a plain `!price` check would never repair those drafts; they are repaired
 * here once rates arrive.
 *
 * Returns the sats price to store, or null when no derivation applies.
 */
export function deriveSatsPriceFromFiat(state: SatsDerivationState, convert: (amount: number, currency: string) => number): string | null {
	if (!state.hasExchangeRates) return null
	if (state.currencyMode !== 'fiat') return null

	const fiatValue = parseFloat(state.fiatPrice)
	if (!(fiatValue > 0)) return null

	const satsUnresolved = state.price === '' || state.price === '0'
	if (!satsUnresolved) return null

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

/**
 * Resolves the price/currency pair to publish, honouring the form's
 * fiat-fixed vs sats-fixed mode:
 *
 * - Bitcoin currencies always publish in SATS.
 * - Fiat-fixed mode publishes the explicit fiat value; the derived sats price
 *   may still be unresolved (rates never arrived) and must not block it.
 * - Sats-fixed mode publishes the sats price and fails closed while it is
 *   unresolved, rather than coercing it to '0'.
 */
export function resolvePublishPrice(state: ProductPriceFormState): PublishPriceResolution {
	if (state.currency === 'SATS' || state.currency === 'BTC') {
		if (!isValidNumberString(state.price)) {
			return { status: 'error', reason: 'unresolved-sats-price' }
		}
		return { status: 'ok', price: convertBitcoinToSatsString(state.price, state.bitcoinUnit), currency: 'SATS' }
	}

	if (state.currencyMode === 'fiat') {
		if (!isValidNumberString(state.fiatPrice)) {
			return { status: 'error', reason: 'missing-fiat-price' }
		}
		return { status: 'ok', price: state.fiatPrice, currency: state.currency }
	}

	if (!isValidNumberString(state.price)) {
		return { status: 'error', reason: 'unresolved-sats-price' }
	}
	return { status: 'ok', price: convertBitcoinToSatsString(state.price, state.bitcoinUnit), currency: 'SATS' }
}

function convertBitcoinToSatsString(price: string, bitcoinUnit: 'SATS' | 'BTC'): string {
	const bitcoinValue = parseFloat(price)
	const satsValue = bitcoinUnit === 'BTC' ? bitcoinValue * 100000000 : bitcoinValue
	return satsValue.toString()
}
