/**
 * NUT-12 DLEQ verification module.
 *
 * Cashu proofs can carry a Discreet Log Equality (DLEQ) proof that lets
 * any third party verify — offline, at bid time — that (a) the proof is
 * really minted by the referenced mint for the claimed amount and keyset,
 * and (b) the blinding factor `r` lets the verifier reblind the
 * proof-to-signature mapping.
 *
 * Reference: https://github.com/cashubtc/nuts/blob/main/12.md
 *
 * What this module provides:
 *
 * - {@link verifyProofDleq}  — verify a single proof's DLEQ against a keyset.
 * - {@link verifyBidDleq}    — batch-verify a bid's DLEQ proofs + sum check.
 * - {@link getMintKeyset}    — thin wrapper over `CashuMint.getKeys`.
 *
 * All verification functions are **non-throwing**: any internal error
 * (missing amount key, malformed data) produces `false` rather than
 * an uncaught exception. This is fail-closed by design — a validator
 * polling many bids should not crash on a single bad proof.
 */

import { CashuMint, hasValidDleq, type MintKeys, type Proof } from '@cashu/cashu-ts'
import type { CashuCustomRequest } from './nut7'

// ---------- Public types ----------------------------------------------------

/** A serialized DLEQ proof extracted from a `dleq_proof` bid-event tag. */
export interface DleqProof {
	/** Keyset ID (hex). */
	id: string
	/** Amount denominated in Satoshis. */
	amount: number
	/** Unblinded signature `C` (compressed secp256k1 hex, 33 bytes / 66 chars). */
	C: string
	/** DLEQ challenge `e` (hex). */
	e: string
	/** DLEQ response `s` (hex). */
	s: string
	/** Blinding factor `r` (hex). */
	r: string
}

/** Result shape returned by {@link verifyBidDleq}. */
export interface DleqVerifyResult {
	/** True when ALL proofs pass AND amounts sum to the leg delta. */
	ok: boolean
	/** True when `sum(proofs[].amount) === legDelta`. */
	matchesAmount: boolean
	/** True when every proof's DLEQ verified successfully. */
	allProofsValid: boolean
	/** Index of the first failing proof (0-based), or undefined when all pass. */
	failedProofIndex?: number
}

/** Options for {@link getMintKeyset}. */
export interface GetMintKeysetOptions {
	/**
	 * Policy-enforcing custom request transport, passed through to the
	 * `CashuMint` constructor. Uses the shared {@link CashuCustomRequest}
	 * shape also used by `nut7.ts`. Useful for destination allowlisting.
	 */
	customRequest?: CashuCustomRequest
}

// ---------- buildDleqProofs -------------------------------------------------

/**
 * Build the `DleqProof[]` array for a bid's `dleq_proof` tags from the
 * locked proofs returned by `lockAuctionBidFunds`.
 *
 * Each locked proof must carry a NUT-12 DLEQ proof (with the blinding
 * factor `r`) — post-rollout, a proof without DLEQ is unverifiable at
 * bid time (ADR-0011 Decision 1/5). This helper is **fail-closed**: it
 * throws on the first proof that lacks `dleq` (or a usable `r`) rather
 * than silently emitting a partial/empty array, so the publisher can
 * never publish a bid whose collateral cannot be verified.
 *
 * The returned array is parallel to the caller's `lockSecrets`/`proofYs`
 * arrays (same order, same length), matching the 1-to-1 invariant
 * enforced by `buildBidEventTags`.
 *
 * @param proofs — the locked proofs (each carrying `secret`, `C`, and `dleq`).
 * @returns one {@link DleqProof} per locked proof, in order.
 * @throws when any proof lacks `dleq` or a non-empty `r`.
 */
export const buildDleqProofs = (proofs: Proof[]): DleqProof[] => {
	return proofs.map((proof, index) => {
		const dleq = proof.dleq
		if (!dleq || !dleq.r || dleq.r.length === 0) {
			throw new Error(
				`buildDleqProofs: locked proof at index ${index} lacks a NUT-12 DLEQ proof (or blinding factor r) — refusing to publish unverifiable collateral (ADR-0011)`,
			)
		}
		return {
			id: proof.id,
			amount: proof.amount,
			C: proof.C,
			e: dleq.e,
			s: dleq.s,
			r: dleq.r,
		}
	})
}

// ---------- verifyProofDleq -------------------------------------------------

/**
 * Verify a single proof's DLEQ against a keyset.
 *
 * Wraps `hasValidDleq` from `@cashu/cashu-ts` in a try/catch so that a
 * missing amount key in the keyset (which `hasValidDleq` throws for)
 * becomes `false` — fail-closed.
 *
 * @returns `true` when the DLEQ proof is valid for the claimed amount.
 */
export const verifyProofDleq = (proof: DleqProof & { secret: string }, keyset: MintKeys): boolean => {
	try {
		// Build the Proof shape `hasValidDleq` expects (model-level).
		// `r` is required — NUT-12 needs the blinding factor to reblind
		// verify offline. We deliberately fail-closed on empty/missing `r`
		// rather than defer to `hasValidDleq`'s lenient default (which
		// substitutes `r="00"` and would fail crypto verification anyway).
		if (!proof.r || proof.r.length === 0) return false

		const p: Proof = {
			id: proof.id,
			amount: proof.amount,
			secret: proof.secret,
			C: proof.C,
			dleq: {
				e: proof.e,
				s: proof.s,
				r: proof.r,
			},
		}

		return hasValidDleq(p, keyset)
	} catch {
		// Any throw → false (fail-closed). `hasValidDleq` throws when
		// `amount` has no corresponding key in `keyset.keys`, but any
		// future library regression (malformed point, etc.) must also
		// surface as `false`, never as an uncaught exception nor as an
		// implicit accept.
		return false
	}
}

// ---------- verifyBidDleq ---------------------------------------------------

/**
 * Batch-verify all DLEQ proofs for a bid and check the amount sum.
 *
 * @param bid.legDelta  — the declared leg delta (amount change since the
 *   previous bid, or the full bid amount for a single-leg bid).
 * @param bid.proofs   — ordered list of proofs each carrying secret + DLEQ.
 * @param keyset       — the mint's public keys for the claimed keyset.
 *
 * @returns A {@link DleqVerifyResult} with `ok` only when `allProofsValid`
 *   AND `matchesAmount`. The caller composes this with NUT-7 state to
 *   determine full bid validity.
 */
export const verifyBidDleq = (
	bid: { legDelta: number; proofs: Array<DleqProof & { secret: string }> },
	keyset: MintKeys,
): DleqVerifyResult => {
	let allProofsValid = true
	let failedProofIndex: number | undefined

	for (let i = 0; i < bid.proofs.length; i++) {
		if (!verifyProofDleq(bid.proofs[i], keyset)) {
			allProofsValid = false
			failedProofIndex = i
			break // fail-fast: report the first failure
		}
	}

	const proofSum = bid.proofs.reduce((sum, p) => sum + p.amount, 0)
	const matchesAmount = proofSum === bid.legDelta

	return {
		ok: allProofsValid && matchesAmount,
		matchesAmount,
		allProofsValid,
		...(failedProofIndex !== undefined ? { failedProofIndex } : {}),
	}
}

// ---------- getMintKeyset ---------------------------------------------------

/**
 * Thin wrapper over `CashuMint.getKeys` — fetches the keyset for a
 * given mint URL and keyset ID.
 *
 * Network policy (destination allowlisting, timeouts) belongs at the
 * caller, not inside this pure helper. The optional `customRequest`
 * transport lets the caller enforce outbound destination policy
 * without this module knowing about it.
 *
 * @returns The first matching keyset from the mint's `/v1/keys` response.
 */
export const getMintKeyset = async (mintUrl: string, keysetId: string, opts?: GetMintKeysetOptions): Promise<MintKeys> => {
	const mint = new CashuMint(mintUrl, opts?.customRequest as never)
	const response = await mint.getKeys(keysetId)
	return response.keysets[0]
}
