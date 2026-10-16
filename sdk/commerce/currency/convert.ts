/**
 * currency/convert.ts — **the conversion: a currency amount, through the CVM read, to sats**.
 *
 * This is the module's entry. It composes the two halves that already exist —
 * `./rate` (read the rate through ContextVM) and the arithmetic below — and it is
 * the only place a caller has to touch.
 *
 * **The money rule it inherits, unchanged (`D-MONEY`, landed by M1 in
 * `sdk/commerce/cart/money.ts`).** A currency declares its precision in decimal
 * places; every amount is carried as an **integer count of minor units**; integers
 * are scaled; and the answer is an **integer number of satoshis** — the smallest
 * unit has no fractional part. `0.00185 × 3` is `0.005550000000000001` in binary
 * floating point and that is the arithmetic showing through the price, so nothing
 * here multiplies decimals. The rate read from the CVM is a decimal JSON number, so
 * it is shifted to minor units **once** (`toMinorUnits`, a decimal shift via
 * `toFixed`, not a binary multiply) and every step after that is `BigInt`.
 *
 * **A currency with no declared precision is refused by name.** `SAT` and `BTC` are
 * definitions — one bitcoin *is* 100 000 000 satoshis — and need no oracle at all.
 * Everything else is a fiat amount whose precision this module declares; a currency
 * it does not declare is `undeclared-currency-precision`, never an assumed `2`.
 *
 * **The precision table is the money rule's table, and this is its second copy.**
 * `D-MONEY` says *a currency declares its precision* and wants the declaration to
 * live with the currency rather than beside whoever sums it. `src/lib/constants.ts:72`
 * names the 29 currencies this repository offers and declares no precision for any
 * of them. M1 wrote the missing half once; `sdk/commerce/cart/money.ts` is its
 * first home. This module is not on that branch, so the table is repeated here —
 * deliberately and reported as a **named need**, not passed off as a coincidence:
 * the two copies must converge on one declaration when the branches meet.
 *
 * **Named need (reported, not fixed here).** `src/lib/constants.ts:72` spells
 * satoshi `SATS`; the SDK emits `SAT` (`sdk/commerce/products/currencyNotation.ts`,
 * landed by M3). This module accepts both and emits neither — it answers in sats —
 * but the two spellings remain a single term with two values in the tree.
 *
 * **A float sum on the path, reported rather than fixed.** `sdk/commerce/cart/money.ts`
 * fixes the cart's `+`-on-floats sum; that work is a sibling increment (M1) and is
 * not duplicated here.
 *
 * **Assumptions surfaced (see `./assumptions`):** `currency-precision-is-declared-not-assumed`,
 * `one-btc-per-100m-sats`.
 */

import { createWorkflowError, type WorkflowError } from '../../core/errors'
import { readCurrencyRate, type CurrencyRateRead } from './rate'
import type { CvmEndpoint } from './endpoint'
import type { CvmRateTransportFactory } from './transport'

/** Satoshis are counted in satoshis and have no fractional part. */
const SAT_PRECISION = 0

/** One bitcoin is 100 000 000 satoshis, so a BTC amount has 8 decimal places. */
const BTC_PRECISION = 8

/** The ISO 4217 currencies whose minor unit is the unit itself. */
const NO_DECIMAL_PLACES = 0

/** One bitcoin, in satoshis. The definition, not a rate. */
export const SATOSHIS_PER_BITCOIN = 100_000_000

/** The canonical spelling this repository's SDK emits for satoshi (`currencyNotation.ts`, M3). */
export const BITCOIN_CURRENCY = 'SAT'

/**
 * The minor unit of every currency this repository names, in decimal places.
 *
 * Bitcoin units first, then the fiat currencies `src/lib/constants.ts:72` offers.
 * **The same table M1 declared** (`sdk/commerce/cart/money.ts`); see this file's
 * header for why it is repeated and what the two copies owe each other.
 */
export const CURRENCY_PRECISION: Readonly<Record<string, number>> = Object.freeze({
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
})

/** The precision a currency declares, or `null` when this module declares none for it. */
export function currencyPrecision(currency: string): number | null {
	return Object.prototype.hasOwnProperty.call(CURRENCY_PRECISION, currency) ? (CURRENCY_PRECISION[currency] as number) : null
}

/**
 * Normalise a currency to what this module compares against.
 *
 * Read path only, and the same acceptance list M3 measured in production: `SAT`,
 * `SATS`, `sat` and `sats` are one term, normalised to `SAT`; anything else is
 * upper-cased and passed through. A missing currency is left empty and will fail
 * precision resolution by name rather than silently becoming a fiat.
 */
export function normalizeCurrency(raw: string | undefined | null): string {
	const upper = (raw ?? '').trim().toUpperCase()
	if (upper === 'SAT' || upper === 'SATS') return BITCOIN_CURRENCY
	return upper
}

/**
 * An amount of a currency, as an integer count of its minor units.
 *
 * A **decimal shift, not a binary multiply**: `toFixed` writes the amount out at
 * the declared precision and the decimal point is dropped, so `0.0001` at 8 places
 * is exactly `10000` with no float in between. Non-finite input is not a number of
 * anything and counts as nothing.
 */
export function toMinorUnits(amount: number, precision: number): number {
	if (!Number.isFinite(amount)) return 0
	const [whole = '0', fraction = ''] = amount.toFixed(precision).split('.')
	return Number(`${whole}${fraction}`)
}

/**
 * A minor-unit fiat amount, at a BTC rate, as a whole number of satoshis.
 *
 * `rate` is what the CVM says one BTC is worth in the currency (BTC per the other
 * way round: `1 BTC = rate CURRENCY`), so the arithmetic is
 * `amountMinor × 10^8 ÷ rateMinor` with the rate itself shifted to the currency's
 * declared minor unit first. Every step is `BigInt`; the single rounding is
 * half-up at the last step, and the result is refused (`null`) rather than returned
 * when it leaves the range a JavaScript integer can hold.
 *
 * `null` means "this pair cannot be converted", never "zero". The caller turns it
 * into a named refusal.
 */
export function fiatMinorToSats(amountMinor: number, precision: number, rate: number): number | null {
	if (!Number.isInteger(amountMinor)) return null
	if (!Number.isFinite(rate) || rate <= 0) return null
	const rateMinor = toMinorUnits(rate, precision)
	if (!Number.isInteger(rateMinor) || rateMinor <= 0) return null

	const numerator = BigInt(amountMinor) * BigInt(SATOSHIS_PER_BITCOIN)
	const denominator = BigInt(rateMinor)
	const quotient = numerator / denominator
	const remainder = numerator % denominator
	const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient

	const sats = Number(rounded)
	return Number.isSafeInteger(sats) ? sats : null
}

/** Every way a conversion has no answer. Each is a state; none is `0`. */
export type CurrencyConversionFailureReason =
	| 'endpoint-refused'
	| 'cvm-unreachable'
	| 'rate-tool-error'
	| 'rate-absent'
	| 'rate-malformed'
	| 'undeclared-currency-precision'
	| 'amount-not-convertible'

/** A conversion that produced sats. */
export type CurrencyConversionSuccess = {
	readonly state: 'converted'
	/** The currency the input amount was in, normalised. */
	readonly currency: string
	/** Whole satoshis. Always an integer; never a float. */
	readonly sats: number
	/** `definition` when no oracle was needed (BTC/SAT); `rate` when the CVM answered. */
	readonly source: 'definition' | 'rate'
	/** The CVM rate used, or `null` for a definition. */
	readonly rate: number | null
	readonly fetchedAt: number
	readonly cached: boolean
}

/** A conversion that produced no answer, and the named reason. */
export type CurrencyConversionFailure = {
	readonly state: 'unavailable'
	readonly currency: string
	readonly reason: CurrencyConversionFailureReason
	readonly detail: string
	readonly failure: WorkflowError
}

export type CurrencyConversion = CurrencyConversionSuccess | CurrencyConversionFailure

export interface ConvertCurrencyToSatsParams {
	/** The amount, as an **integer count of `currency`'s minor units**. Never a decimal. */
	readonly amountMinor: number
	/** The currency the amount is in. `SAT`/`SATS`/`sat`/`sats` normalise to `SAT`. */
	readonly currency: string
	/** **Injected by the app** — the production CVM. `undefined` is a named refusal. */
	readonly endpoint: Partial<CvmEndpoint> | undefined
	/** **Injected by the app** (or by a test). */
	readonly transport: CvmRateTransportFactory
}

function unavailable(
	currency: string,
	reason: CurrencyConversionFailureReason,
	detail: string,
	cause?: unknown,
): CurrencyConversionFailure {
	return {
		state: 'unavailable',
		currency,
		reason,
		detail,
		failure: createWorkflowError({ workflow: 'commerce.currency', phase: reason, error: cause ?? new Error(detail) }),
	}
}

/** Carry a rate read's own named failure through unchanged — the reason is the rate's, not a new one. */
function fromRateFailure(currency: string, read: Extract<CurrencyRateRead, { state: 'unavailable' }>): CurrencyConversionFailure {
	return unavailable(currency, read.reason, read.detail, read.failure)
}

/**
 * Convert an amount to satoshis, reading the rate through the ContextVM oracle the
 * app injected.
 *
 * Two currencies need no oracle, and say so rather than pretending to read one:
 * `SAT` is already sats, and a `BTC` amount's 8-decimal minor units **are** sats.
 * Both answer `source: 'definition'` and never call the transport — which is also
 * the honest reason an "offline" BTC conversion works with no endpoint at all.
 *
 * Every other currency, in order: resolve its declared precision (refusing by name
 * when there is none, **before** any socket is opened), read the rate through the
 * injected endpoint, then scale. If the read has no rate, its reason travels
 * unchanged — this function never invents a reason and never returns a number.
 */
export async function convertCurrencyToSats(params: ConvertCurrencyToSatsParams): Promise<CurrencyConversion> {
	const currency = normalizeCurrency(params.currency)

	if (currency === BITCOIN_CURRENCY) {
		if (!Number.isInteger(params.amountMinor)) {
			return unavailable(currency, 'amount-not-convertible', `A SAT amount must be an integer count of satoshis; got ${String(params.amountMinor)}.`)
		}
		return { state: 'converted', currency, sats: params.amountMinor, source: 'definition', rate: null, fetchedAt: 0, cached: false }
	}

	const precision = currencyPrecision(currency)
	if (precision === null) {
		return unavailable(
			currency,
			'undeclared-currency-precision',
			`No precision is declared for currency "${currency}", so the amount cannot be counted in minor units. This module will not assume how many decimal places a currency it does not declare has.`,
		)
	}

	if (currency === 'BTC') {
		if (!Number.isInteger(params.amountMinor)) {
			return unavailable(currency, 'amount-not-convertible', `A BTC amount must be an integer count of its 8-decimal minor units; got ${String(params.amountMinor)}.`)
		}
		// One BTC is 100 000 000 sats by definition, so a BTC amount's 8-decimal
		// minor units are already satoshis — no rate, no oracle, no rounding.
		return { state: 'converted', currency, sats: params.amountMinor, source: 'definition', rate: null, fetchedAt: 0, cached: false }
	}

	if (!Number.isInteger(params.amountMinor)) {
		return unavailable(currency, 'amount-not-convertible', `A ${currency} amount must be an integer count of its minor units; got ${String(params.amountMinor)}.`)
	}

	const read = await readCurrencyRate({ currency, endpoint: params.endpoint, transport: params.transport })
	if (read.state !== 'rate') return fromRateFailure(currency, read)

	const sats = fiatMinorToSats(params.amountMinor, precision, read.rate)
	if (sats === null) {
		return unavailable(
			currency,
			'amount-not-convertible',
			`The ${currency} amount and the rate read from the CVM (${String(read.rate)}) do not produce a satoshi count that fits a JavaScript integer.`,
		)
	}

	return { state: 'converted', currency, sats, source: 'rate', rate: read.rate, fetchedAt: read.fetchedAt, cached: read.cached }
}
