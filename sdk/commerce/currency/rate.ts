/**
 * currency/rate.ts — **reading one currency's BTC rate through ContextVM**.
 *
 * This is the read half: ask the CVM's `get_btc_price_single` tool what one BTC is
 * worth in a currency, and answer with either **a rate** or **a named reason there
 * is none**. It is not a converter (`./convert` is) and it holds no precision
 * table; it reads, and it decides nothing about money.
 *
 * **The rule it exists to enforce — an unavailable rate is its own state.** The
 * defect this replaces is the one the surface already admitted to: a conversion
 * path that answers `0` when it has no rate. `0` is the most expensive wrong answer
 * a market can give, because it prices a good at nothing and looks like a price. So
 * every failure below is a distinct `reason`, the success type has no `sats` field
 * to accidentally read, and a **non-positive or non-finite rate is refused by name**
 * (`rate-malformed`) rather than divided by.
 *
 * The tool it calls is the server's own registered tool, cited from the server:
 * `contextvm/server.ts:204-253` registers `get_btc_price_single` with the input
 * shape `{ currency, refresh }` and the output shape
 * `{ currency, rate, fetchedAt, cached }` (`contextvm/schemas.ts:20-25`).
 *
 * **Assumptions surfaced (see `./assumptions`):** `cvm-rate-is-truth`,
 * `cvm-tool-shape`, `stale-rate-is-not-judged`.
 */

import { createWorkflowError, type WorkflowError } from '../../core/errors'
import { validateCvmEndpoint, type CvmEndpoint } from './endpoint'
import type { CvmRateTransportFactory, CvmToolAnswer } from './transport'

/** The CVM tool that answers one currency's BTC rate — `contextvm/server.ts:205`. */
export const BTC_PRICE_SINGLE_TOOL = 'get_btc_price_single'

/** Every way there is no rate. None of them is a number. */
export type CurrencyRateFailureReason =
	| 'endpoint-refused'
	| 'cvm-unreachable'
	| 'rate-tool-error'
	| 'rate-absent'
	| 'rate-malformed'

/** No rate, and why. */
export type CurrencyRateFailure = {
	readonly state: 'unavailable'
	readonly currency: string
	readonly reason: CurrencyRateFailureReason
	readonly detail: string
	/** The same failure as the SDK's shared error type, for callers that log or re-throw. */
	readonly failure: WorkflowError
}

/** A rate, with where it came from and how old the server says it is. */
export type CurrencyRateSuccess = {
	readonly state: 'rate'
	readonly currency: string
	/** What one BTC is worth in `currency`. Always finite and strictly positive. */
	readonly rate: number
	/** Unix ms the server fetched the rates, or `0` when it did not say. */
	readonly fetchedAt: number
	/** Whether the server served this from its own cache. Carried, not judged. */
	readonly cached: boolean
	/** The system this rate was read through. Named, so a caller cannot mistake a fixture for it. */
	readonly source: 'contextvm'
}

export type CurrencyRateRead = CurrencyRateSuccess | CurrencyRateFailure

export interface ReadCurrencyRateParams {
	/** ISO-4217-style code, e.g. `USD`, `JPY`. Normalised to upper case here. */
	readonly currency: string
	/** **Injected by the app.** `undefined` is a named refusal, not a default. */
	readonly endpoint: Partial<CvmEndpoint> | undefined
	/** **Injected by the app** (or by a test). Built from the endpoint it is handed. */
	readonly transport: CvmRateTransportFactory
}

/** A plain-object check, so a `structuredContent` of any type can be read without a cast. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function refusal(currency: string, reason: CurrencyRateFailureReason, detail: string, cause?: unknown): CurrencyRateFailure {
	return {
		state: 'unavailable',
		currency,
		reason,
		detail,
		failure: createWorkflowError({ workflow: 'commerce.currency', phase: reason, error: cause ?? new Error(detail) }),
	}
}

/**
 * Read one currency's BTC rate through the ContextVM oracle the app configured.
 *
 * Order matters and is deliberate: the endpoint is validated **before** a transport
 * is built (a bad endpoint must not open a socket), and the transport is closed
 * **once**, on every path, including the failure ones.
 */
export async function readCurrencyRate(params: ReadCurrencyRateParams): Promise<CurrencyRateRead> {
	const currency = params.currency.trim().toUpperCase()

	const endpoint = validateCvmEndpoint(params.endpoint)
	if (!endpoint.ok) return refusal(currency, 'endpoint-refused', `${endpoint.reason}: ${endpoint.detail}`)

	let answer: CvmToolAnswer
	try {
		const transport = params.transport(endpoint.endpoint)
		try {
			answer = await transport.callTool({ name: BTC_PRICE_SINGLE_TOOL, arguments: { currency } })
		} finally {
			try {
				await transport.close()
			} catch {
				// Closing is best-effort: a transport that cannot close must not erase the answer.
			}
		}
	} catch (error) {
		return refusal(currency, 'cvm-unreachable', `The CVM transport failed: ${messageOf(error)}`, error)
	}

	if (!answer.ok) return refusal(currency, 'cvm-unreachable', answer.detail)

	const structured = answer.structured

	// The server answers a refusal as `isError` with `structuredContent: { error }`
	// (`contextvm/server.ts:216-234`). It is a *server that answered*, so it is a
	// tool error, not an unreachable CVM — the caller can tell "no rate for XYZ"
	// from "the oracle is down".
	if (answer.isError) {
		const detail =
			isRecord(structured) && typeof structured.error === 'string'
				? structured.error
				: 'The CVM reported a tool error with no structured detail.'
		return refusal(currency, 'rate-tool-error', detail)
	}

	if (!isRecord(structured)) {
		return refusal(currency, 'rate-malformed', 'The CVM answered without a structured result, so there is no rate to read.')
	}
	if (typeof structured.error === 'string') {
		return refusal(currency, 'rate-tool-error', structured.error)
	}

	const rate = structured.rate
	if (rate === undefined || rate === null) {
		return refusal(currency, 'rate-absent', `The CVM answered for ${currency} without a rate field.`)
	}
	if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
		return refusal(
			currency,
			'rate-malformed',
			`The CVM answered with a non-positive or non-finite rate for ${currency} (${String(rate)}). A rate of zero prices the goods at nothing, so it is refused rather than used.`,
		)
	}

	return {
		state: 'rate',
		currency: typeof structured.currency === 'string' ? structured.currency.trim().toUpperCase() : currency,
		rate,
		fetchedAt: typeof structured.fetchedAt === 'number' && Number.isFinite(structured.fetchedAt) ? structured.fetchedAt : 0,
		cached: structured.cached === true,
		source: 'contextvm',
	}
}
