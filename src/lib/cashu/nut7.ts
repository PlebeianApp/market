/**
 * NUT-7 proof-state client helper.
 *
 * Cashu mints expose a "check state" endpoint that takes a list of
 * `Y = hash_to_curve(secret)` values and returns the spend state of
 * each (`UNSPENT` / `PENDING` / `SPENT`). The bid event publishes
 * `proof_y` precisely so any third-party validator can run this check
 * without holding the full proof.
 *
 * Reference: https://github.com/cashubtc/nuts/blob/main/07.md
 *
 * What this module provides:
 *
 * - {@link checkProofState}     — query the state of one proof by its Y.
 * - {@link checkProofStateBatch} — batch lookup for multiple Ys, one mint.
 *
 * Both return a normalized {@link Nut7ProofState} (`'unspent' | 'pending'
 * | 'spent' | 'unknown'`) — `'unknown'` is reserved for mint-side
 * errors / network failures so callers can distinguish "mint said
 * something I can't classify" from "I have no signal" without
 * surfacing transport details up the stack.
 *
 * Bounded timeout + non-throwing semantics by design: validators poll
 * many proofs across many auctions and a single mint hiccup should
 * downgrade individual readings to `'unknown'`, not crash the loop.
 */

import { CashuMint, CheckStateEnum, type CheckStateResponse } from '@cashu/cashu-ts'
import type { Nut7ProofState } from '../auction/constants'

// ---------- Configuration ------------------------------------------------

/** Default per-mint request timeout in milliseconds. */
export const DEFAULT_NUT7_TIMEOUT_MS = 8_000

/** Default batch size — most mints accept a few hundred Ys per call. */
export const DEFAULT_NUT7_BATCH_SIZE = 100

// ---------- Public API ---------------------------------------------------

export interface CheckProofStateOptions {
	/** Per-request timeout in ms. Defaults to {@link DEFAULT_NUT7_TIMEOUT_MS}. */
	timeoutMs?: number
	/**
	 * Pre-built CashuMint instance. When provided, no fresh client is
	 * constructed — useful for callers that already maintain mint
	 * pools (e.g. the validator process subscribed to many mints).
	 */
	mintClient?: CashuMint
}

/**
 * Query the state of a single proof at a mint.
 *
 * Returns `'unknown'` on:
 *   - network errors
 *   - response timeout
 *   - mint returning a state the spec doesn't define
 *   - mint returning no entry for the requested Y
 *
 * Callers MUST treat `'unknown'` as "no signal, retry" — not "safe".
 */
export const checkProofState = async (
	mintUrl: string,
	proofY: string,
	options: CheckProofStateOptions = {},
): Promise<Nut7ProofState> => {
	const states = await checkProofStateBatch(mintUrl, [proofY], options)
	return states.get(proofY.toLowerCase()) ?? 'unknown'
}

/**
 * Batch state lookup. Returns a Map keyed by the lower-cased input Y
 * (mints have historically been case-sensitive but field-normalising
 * here lets callers compare without worrying about it).
 *
 * Inputs the caller passes that don't appear in the mint's response
 * land in the returned map as `'unknown'`.
 */
export const checkProofStateBatch = async (
	mintUrl: string,
	proofYs: string[],
	options: CheckProofStateOptions = {},
): Promise<Map<string, Nut7ProofState>> => {
	const out = new Map<string, Nut7ProofState>()
	if (!proofYs.length) return out

	for (const y of proofYs) out.set(y.toLowerCase(), 'unknown')

	const timeoutMs = options.timeoutMs ?? DEFAULT_NUT7_TIMEOUT_MS
	const mint = options.mintClient ?? new CashuMint(mintUrl)

	const batches: string[][] = []
	for (let i = 0; i < proofYs.length; i += DEFAULT_NUT7_BATCH_SIZE) {
		batches.push(proofYs.slice(i, i + DEFAULT_NUT7_BATCH_SIZE))
	}

	for (const batch of batches) {
		let response: CheckStateResponse | undefined
		try {
			response = await withTimeout(mint.check({ Ys: batch }), timeoutMs, `NUT-7 check ${mintUrl}`)
		} catch (err) {
			// Network / timeout / mint error. Leave this batch's Ys as
			// 'unknown' so the validator can retry later. Don't log here —
			// callers know which mint/proofs they queried and can decide
			// whether the failure is interesting.
			void err
			continue
		}

		if (!response || !Array.isArray(response.states)) continue

		for (const entry of response.states) {
			if (!entry || typeof entry.Y !== 'string') continue
			out.set(entry.Y.toLowerCase(), normaliseState(entry.state))
		}
	}

	return out
}

// ---------- Internals ----------------------------------------------------

/**
 * Map the cashu-ts {@link CheckStateEnum} value to our `Nut7ProofState`.
 * Unknown / unexpected values fall through to `'unknown'`.
 */
const normaliseState = (state: unknown): Nut7ProofState => {
	if (state === CheckStateEnum.UNSPENT || state === 'UNSPENT') return 'unspent'
	if (state === CheckStateEnum.PENDING || state === 'PENDING') return 'pending'
	if (state === CheckStateEnum.SPENT || state === 'SPENT') return 'spent'
	return 'unknown'
}

/**
 * Race a promise against a timeout. The timeout rejects with a labelled
 * Error so callers' logs can pinpoint which mint stalled.
 */
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeoutMs}ms`)), timeoutMs)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(err) => {
				clearTimeout(timer)
				reject(err)
			},
		)
	})
}
