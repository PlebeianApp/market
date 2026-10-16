const SATS_PER_BTC = 100_000_000

export interface PriceDisplayInput {
	priceValue: number
	originalCurrency: string
	/** Viewer's preferred fiat currency, used when the listing is priced in BTC/SATS. */
	selectedCurrency: string
	/** BTC price per fiat currency code; undefined while rates are unavailable. */
	exchangeRates?: Readonly<Record<string, number | undefined>>
	/** Host-converted sats value for fiat-priced listings. */
	satsFromFiat?: number | null
}

export interface PriceDisplayResolution {
	isBitcoinCurrency: boolean
	satsValue: number | null
	fiatValue: { value: number; currency: string } | null
}

export function isBitcoinCurrency(currency: string): boolean {
	const upper = currency.toUpperCase()
	return upper === 'SATS' || upper === 'BTC'
}

/** Resolves the sats price and the secondary fiat price shown next to a listing. */
export function resolvePriceDisplay(input: PriceDisplayInput): PriceDisplayResolution {
	const { priceValue, originalCurrency, selectedCurrency, exchangeRates, satsFromFiat } = input
	const bitcoin = isBitcoinCurrency(originalCurrency)
	const upper = originalCurrency.toUpperCase()

	let satsValue: number | null = null
	if (upper === 'SATS') satsValue = priceValue
	else if (upper === 'BTC') satsValue = Math.round(priceValue * SATS_PER_BTC)
	else satsValue = satsFromFiat || null

	let fiatValue: PriceDisplayResolution['fiatValue'] = null
	if (exchangeRates && satsValue) {
		const currency = bitcoin ? selectedCurrency : originalCurrency
		const rate = exchangeRates[currency]
		if (rate) fiatValue = { value: (satsValue / SATS_PER_BTC) * rate, currency }
	}

	return { isBitcoinCurrency: bitcoin, satsValue, fiatValue }
}
