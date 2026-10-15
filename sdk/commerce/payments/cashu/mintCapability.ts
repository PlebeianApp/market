/**
 * Mint NUT-12 DLEQ capability probe.
 *
 * ADR-0011 (Decisions 4 & 5) requires NUT-12 DLEQ-capable mints for
 * post-rollout auctions. A mint advertises NUT-12 support via its
 * `/v1/info` endpoint — the `nuts` map carries a `"12"` entry with
 * `supported: true` when the mint produces DLEQ proofs at issuance/swap.
 * This is the same advertisement the reference nutshell mint emits.
 *
 * Reference: https://github.com/cashubtc/nuts/blob/main/12.md
 *
 * What this module provides:
 *
 * - {@link mintSupportsDleq} — probe whether a mint advertises NUT-12
 *   DLEQ support.
 *
 * Fail-closed by design: any network error, timeout, malformed response,
 * or missing `"12"` entry resolves to `false`, never a permissive `true` —
 * a mint we couldn't confirm is treated as non-DLEQ so a post-rollout
 * auction can never slip through on an unverified mint.
 */

import { CashuMint } from '@cashu/cashu-ts'
import type { CashuCustomRequest } from './nut7'

// ---------- Configuration -----------------------------------------------------

/** Default per-mint `/v1/info` request timeout in milliseconds. */
export const DEFAULT_MINT_INFO_TIMEOUT_MS = 8_000

// ---------- Public types ------------------------------------------------------

/** Options for {@link mintSupportsDleq}. */
export interface MintDleqSupportOptions {
	/** Per-request timeout in ms. Defaults to {@link DEFAULT_MINT_INFO_TIMEOUT_MS}. */
	timeoutMs?: number
	/**
	 * Pre-built CashuMint instance. When provided, no fresh client is
	 * constructed — mirrors `CheckProofStateOptions.mintClient` in
	 * `src/lib/cashu/nut7.ts` so callers (and tests) can inject a
	 * policy-enforcing or fake transport.
	 */
	mintClient?: CashuMint
	/**
	 * Policy-enforcing custom request transport, passed through to the
	 * `CashuMint` constructor when no `mintClient` is supplied. Mirrors
	 * the shared {@link CashuCustomRequest} shape from `nut7.ts` so
	 * outbound mint destinations can be validated before contact.
	 */
	customRequest?: CashuCustomRequest
}

// ---------- mintSupportsDleq ---------------------------------------------------

/**
 * Whether a mint advertises NUT-12 DLEQ support (ADR-0011, Decision 4).
 *
 * NUT-12 support is signalled by the mint's `/v1/info` endpoint: the
 * `nuts` map carries a `"12"` entry with `supported: true` when the mint
 * produces DLEQ proofs at issuance/swap. This is probed via
 * `CashuMint.getInfo()` reading `nuts["12"].supported`.
 *
 * Fail-closed by design: any network error, timeout, malformed response,
 * or missing `"12"` entry resolves to `false`, never a permissive `true`.
 * A mint we couldn't confirm is treated as non-DLEQ.
 *
 * @returns `true` when the mint advertises NUT-12 DLEQ support; `false`
 *   on any error or missing advertisement.
 */
export const mintSupportsDleq = async (mintUrl: string, options: MintDleqSupportOptions = {}): Promise<boolean> => {
	const timeoutMs = options.timeoutMs ?? DEFAULT_MINT_INFO_TIMEOUT_MS

	try {
		const mint = options.mintClient ?? new CashuMint(mintUrl, options.customRequest as never)
		const info = await withTimeout(mint.getInfo(), timeoutMs, `mint /v1/info ${mintUrl}`)
		return info?.nuts?.['12']?.supported === true
	} catch {
		return false
	}
}

// ---------- Internal helpers ---------------------------------------------------

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
