/**
 * cart/money.ts — the cart's money arithmetic, in integers.
 *
 * **The rule (`D-MONEY`).** A currency declares its precision in decimal places;
 * every amount of that currency is carried as an **integer count of minor units**;
 * integers are summed; the sum is converted back to a decimal **once, at the
 * edge**. Nothing here rounds mid-computation — and that is the whole point,
 * because the defect this file exists to remove was exactly that:
 * `aggregateCartDisplayTotals` summed currency with `+` on binary floats, and
 * `0.0001 + 0.0002` is `0.00030000000000000003`.
 *
 * **Where the declared precisions come from, stated honestly.**
 * `src/lib/constants.ts:72` names the 29 currencies this repository offers and
 * declares **no precision for any of them**, and `src/lib/schemas/common.ts:5`
 * checks only that a currency code is three capital letters. So the table below is
 * the missing half of that declaration — the minor unit each currency is counted
 * in — and it is written here because the cart module is the thing that sums. It
 * is a **second copy of that list** and that duplication is reported as a named
 * need: `D-MONEY` says "a currency declares its precision", which wants the
 * declaration itself to carry it rather than a second table beside it.
 *
 * **A currency with no declared precision is refused by name.** `minorUnitSum`
 * throws `UndeclaredCurrencyPrecisionError` rather than assuming 8, or 0, or 2 —
 * assuming is the guess this increment was asked to stop making.
 */

/** Sats are counted in satoshis and have no fractional part. */
const SAT_PRECISION = 0

/** One bitcoin is 100 000 000 satoshis, so a BTC amount has 8 decimal places. */
const BTC_PRECISION = 8

/** The ISO 4217 currencies whose minor unit is the unit itself. */
const NO_DECIMAL_PLACES = 0

/**
 * The minor unit of every currency the repository names, in decimal places.
 *
 * The Bitcoin units first — `SAT` and `BTC` are the two currencies
 * `sdk/commerce/products/productPriceResolution.ts` can emit, at the precisions
 * the maintainer gave by name. The rest are the currencies
 * `src/lib/constants.ts:72` offers, at their ISO 4217 minor units.
 */
export const CART_CURRENCY_PRECISION: Readonly<Record<string, number>> = {
	SAT: SAT_PRECISION,
	BTC: BTC_PRECISION,
	USD: 2,
	EUR: 2,
	JPY: NO_DECIMAL_PLACES,
	GBP: 2,
	CHF: 2,
	CNY: 2,
	AUD: 2,
	CAD: 2,
	HKD: 2,
	SGD: 2,
	INR: 2,
	MXN: 2,
	RUB: 2,
	BRL: 2,
	TRY: 2,
	KRW: NO_DECIMAL_PLACES,
	ZAR: 2,
	ARS: 2,
	CLP: NO_DECIMAL_PLACES,
	COP: 2,
	PEN: 2,
	UYU: 2,
	PHP: 2,
	THB: 2,
	IDR: 2,
	MYR: 2,
	NGN: 2,
}

/** The precision a currency declares, or `null` when this module declares none for it. */
export function currencyPrecision(currency: string): number | null {
	return Object.prototype.hasOwnProperty.call(CART_CURRENCY_PRECISION, currency) ? (CART_CURRENCY_PRECISION[currency] as number) : null
}

/**
 * The refusal a currency with no declared precision earns.
 *
 * Named, not silent: a caller that meets this either declared the wrong currency
 * or is summing money in a currency nobody has said how to count.
 */
export class UndeclaredCurrencyPrecisionError extends Error {
	readonly reason = 'undeclared-currency-precision' as const
	readonly currency: string

	constructor(currency: string) {
		super(
			`No precision is declared for currency "${currency}". The cart sums money in integer minor units and will not assume how many decimal places a currency it does not declare has.`,
		)
		this.name = 'UndeclaredCurrencyPrecisionError'
		this.currency = currency
	}
}

/**
 * An amount of a currency, as an integer count of its minor units.
 *
 * The conversion is a **decimal shift, not a binary multiply**: `toFixed` writes
 * the amount out at the currency's declared precision and the decimal point is
 * dropped, so `0.0001` at 8 places is exactly `10000` with no float in between.
 * A non-finite amount is not a number of anything and adds nothing.
 */
export function toMinorUnits(amount: number, precision: number): number {
	if (!Number.isFinite(amount)) return 0
	const [whole = '0', fraction = ''] = amount.toFixed(precision).split('.')
	return Number(`${whole}${fraction}`)
}

/**
 * A sum of minor units, written back as a decimal.
 *
 * This is the **one** conversion at the edge: it happens after every addition has
 * been made in integers, never between them. `30000` at 8 places is `0.0003`.
 */
export function fromMinorUnits(minorUnits: number, precision: number): number {
	return minorUnits / 10 ** precision
}

/** One currency's running sum, held as integer minor units. */
export interface MinorUnitSum {
	readonly currency: string
	/** The currency's declared precision, in decimal places. */
	readonly precision: number
	/** Add a decimal amount of this currency. A non-finite amount adds nothing. */
	add(amount: number): void
	/** The sum so far, in minor units — for arithmetic that stays in integers. */
	minorUnits(): number
	/** The sum so far, as a decimal. The single conversion at the edge. */
	total(): number
}

/**
 * An accumulator for one currency's amounts.
 *
 * Throws `UndeclaredCurrencyPrecisionError` when the currency declares no
 * precision: an accumulator that guessed would produce a number nobody can check.
 */
export function minorUnitSum(currency: string): MinorUnitSum {
	const precision = currencyPrecision(currency)
	if (precision === null) throw new UndeclaredCurrencyPrecisionError(currency)

	let minorUnits = 0
	return {
		currency,
		precision,
		add: (amount: number): void => {
			minorUnits += toMinorUnits(amount, precision)
		},
		minorUnits: (): number => minorUnits,
		total: (): number => fromMinorUnits(minorUnits, precision),
	}
}
