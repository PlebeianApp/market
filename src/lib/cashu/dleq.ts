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
 * - {@link verifyBidDleqWithKeysets} — multi-keyset batch verify (per-proof keyset).
 * - {@link getMintKeyset}    — thin wrapper over `CashuMint.getKeys`.
 *
 * All verification functions are **non-throwing**: any internal error
 * (missing amount key, malformed data) produces `false` rather than
 * an uncaught exception. This is fail-closed by design — a validator
 * polling many bids should not crash on a single bad proof.
 */

import { Amount, Mint as CashuMint, hasValidDleq, type MintKeys, type Proof } from '@cashu/cashu-ts'
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

/** Input for {@link verifyBidDleqWithKeysets}. */
export interface DleqKeysetVerifyInput {
	/** Mint URL the bid's proofs are denominated in (map-key prefix). */
	mint: string
	/** The declared leg delta (amount change since the previous bid). */
	legDelta: number
	/** Ordered proofs, each carrying the wallet secret it was minted with. */
	proofs: Array<DleqProof & { secret: string }>
}

/** Options for {@link getMintKeyset}. */
export interface GetMintKeysetOptions {
	/**
	 * Policy-enforcing custom request transport, passed through to the
	 * `CashuMint` constructor. Uses the shared {@link CashuCustomRequest}
	 * shape also used by `nut7.ts`. Useful for destination allowlisting.
	 */
	customRequest?: CashuCustomRequest
	/**
	 * Bound on the mint HTTP call. ADR-0011 review R3: the keyset fetch is now
	 * called per tick by the client win monitor, so an unbounded mint must not
	 * hang the caller. Defaults to {@link DEFAULT_DLEQ_KEYSET_TIMEOUT_MS}.
	 */
	timeoutMs?: number
}

/** Default per-keyset fetch timeout (ADR-0011 review R3). */
export const DEFAULT_DLEQ_KEYSET_TIMEOUT_MS = 4000

/**
 * A keyset fetch that failed TERMINALLY: the mint answered, but it has no keyset
 * for the requested id (or the id/unit does not match). Distinct from a
 * transient network/timeout failure (ADR-0011 review R3): a terminal miss means
 * the bid's `dleq_proof[].id` names a keyset the mint does not advertise — i.e.
 * fabricated/foreign collateral — so the bid is `dleq_invalid`, not `pending`.
 */
export class DleqKeysetTerminalError extends Error {
	public readonly terminal = true
	constructor(message: string) {
		super(message)
		this.name = 'DleqKeysetTerminalError'
	}
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
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
		const amount = Amount.from(proof.amount).toNumber()
		if (!Number.isSafeInteger(amount) || amount <= 0) {
			throw new Error(`buildDleqProofs: locked proof at index ${index} has an invalid amount`)
		}
		return {
			id: proof.id,
			amount,
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

		return hasValidDleq(p, keyset, { require: true })
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

// ---------- verifyBidDleqWithKeysets ----------------------------------------

/**
 * Verify a bid's DLEQ proofs when the proofs may span more than one
 * keyset, resolving each proof against the keyset named by its OWN
 * `id` (ADR-0011 C1, multi-keyset fix).
 *
 * `keysets` is keyed `${mintUrl}:${keysetId}` — the same contract
 * `fetchDleqKeysetsForBids` produces. Every proof resolves its own
 * keyset; a proof whose keyset is absent from a POPULATED map fails
 * the check (fail-closed — `dleq_proof[].id` is bidder-controlled, so
 * a lookup miss must never be treated as a pass).
 *
 * Caller note (ADR-0011 Decision 6a): absence means EVIDENCE UNAVAILABLE,
 * not fraud. `computeValidatedBids` pre-checks keyset presence and defers
 * a bid with any missing keyset to `pending` instead of calling this
 * function; a `false` from here over complete evidence is a positive
 * verification failure → `dleq_invalid`. The fail-closed contract of this
 * function is unchanged (defense-in-depth for callers that skip the
 * pre-check).
 *
 * @returns A {@link DleqVerifyResult} with `ok` only when every proof
 *   verifies against its own keyset AND the amounts sum to `legDelta`.
 */
export const verifyBidDleqWithKeysets = (bid: DleqKeysetVerifyInput, keysets: Map<string, MintKeys>): DleqVerifyResult => {
	let allProofsValid = true
	let failedProofIndex: number | undefined

	for (let i = 0; i < bid.proofs.length; i++) {
		const proof = bid.proofs[i]
		const keyset = keysets.get(`${bid.mint}:${proof.id}`)
		if (!keyset || !verifyProofDleq(proof, keyset)) {
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
 * Fail-loud (not silently-wrong): a mint that returns no keyset, or a
 * keyset whose `id` does not match the requested `keysetId`, throws.
 * Returning the wrong keys would DLEQ-verify a proof against a
 * mismatched keyset and silently misclassify it, so a mismatch is an
 * error the caller must surface, never a value.
 *
 * @returns The mint's keyset, asserted to match the requested `keysetId`.
 * @throws when the mint returns no keyset, or a keyset with a different `id`,
 *   or a keyset whose `unit` is not `sat`.
 */
export const getMintKeyset = async (mintUrl: string, keysetId: string, opts?: GetMintKeysetOptions): Promise<MintKeys> => {
	const mint = new CashuMint(mintUrl, opts?.customRequest ? { customRequest: opts.customRequest as never } : undefined)
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_DLEQ_KEYSET_TIMEOUT_MS
	// Bound the mint call (R3): a reachable-but-slow mint must not hang, and a
	// timeout is TRANSIENT (evidence may arrive later), not terminal.
	const response = await withTimeout(
		mint.getKeys(keysetId),
		timeoutMs,
		`getMintKeyset: mint ${mintUrl} timed out after ${timeoutMs}ms fetching keyset ${keysetId}`,
	)
	const keyset = response.keysets?.[0]
	if (!keyset) {
		// The mint answered but has no such keyset: a terminal miss (fabricated
		// or foreign keyset id), not a transient outage.
		throw new DleqKeysetTerminalError(`getMintKeyset: mint ${mintUrl} returned no keyset for keyset id ${keysetId}`)
	}
	if (keyset.id !== keysetId) {
		throw new DleqKeysetTerminalError(`getMintKeyset: mint ${mintUrl} returned keyset ${keyset.id}, expected ${keysetId}`)
	}
	// ADR-0011 review A4 (PR #1280, src/lib/cashu/dleq.ts:280): bind the DLEQ
	// collateral to the SAT unit. `unit` is part of a keyset's identity, not a
	// display label — the same mint can publish keysets for several units that
	// share an id namespace, and the signed keys of, say, a usd keyset would
	// DLEQ-verify an equally-denominated non-sat proof as "honest". Auction
	// amounts, `locktime`/reserve math and the NUT-7 poll are all SAT-denominated,
	// so a proof verified against a non-sat keyset would be counted as sat
	// collateral. Fail loudly, exactly as for an id mismatch.
	if (keyset.unit !== 'sat') {
		// Terminal: the mint does not publish a sat keyset under this id.
		throw new DleqKeysetTerminalError(
			`getMintKeyset: mint ${mintUrl} returned keyset ${keysetId} in unit '${keyset.unit}', expected 'sat' — refusing to DLEQ-verify auction collateral against a non-sat keyset`,
		)
	}
	return keyset
}

// ---------- fetchDleqKeysetsForBids -----------------------------------------

/**
 * Fetcher signature used by {@link fetchDleqKeysetsForBids}. Injectable so
 * callers can enforce outbound destination policy (`customRequest`) and
 * tests can substitute a fake transport.
 */
export type DleqKeysetFetcher = (mintUrl: string, keysetId: string) => Promise<MintKeys>

/**
 * Minimal shape of a parsed bid needed to gather its DLEQ keysets.
 *
 * Kept structural (rather than importing `ParsedBidEvent`) so this cashu-level
 * helper has no dependency on the auction event layer.
 */
export interface DleqKeysetBidLike {
	mint: string
	dleqProofs?: Array<{ id: string }>
	/**
	 * Cumulative bid amount, when known. Only used for cap prioritisation:
	 * higher-amount bids are gathered first so a keyset flood degrades secondary
	 * bids rather than a reserve-meeting one (review 2026-09-18).
	 */
	amount?: number
}

/**
 * Gather the mint keysets needed to DLEQ-verify a set of bids (ADR-0011
 * Blocker 1).
 *
 * This is the bounded/allowlisted acquisition step the ingestion and
 * settlement paths MUST run before calling `computeValidatedBids`. Without
 * it, DLEQ verification is skipped and unavailable evidence is treated as
 * valid — the exact gap the review flagged.
 *
 * Bounds:
 *   - Only bids whose `mint` is in `trustedMints` (the auction's allowlist)
 *     are considered. A bid referencing an attacker-supplied mint URL is
 *     NEVER contacted — this prevents turning every viewer into a polling
 *     beacon for an attacker-controlled mint (ADR-0004 §5.6).
 *   - Each distinct `(mint, keysetId)` pair is fetched at most once.
 *   - A failed fetch leaves that entry ABSENT from the returned map, so the
 *     downstream verification sees "evidence unavailable" and classifies the
 *     bid `pending` rather than valid.
 *
 * @param bids - Parsed bids (any without `dleqProofs` are skipped).
 * @param trustedMints - The auction's trusted mint URL allowlist.
 * @param fetcher - Keyset fetcher (defaults to {@link getMintKeyset}).
 * @returns Map keyed by `${mintUrl}:${keysetId}`.
 */
export interface DleqKeysetAcquisition {
	/** `${mintUrl}:${keysetId}` → keyset, for every pair fetched successfully. */
	keysets: Map<string, MintKeys>
	/**
	 * Pairs whose fetch failed TERMINALLY: the mint answered but has no such
	 * keyset (or a mismatched/token-unit id). Such a proof names fabricated or
	 * foreign collateral, so the bid is `dleq_invalid`, not `pending`.
	 */
	unknownKeysets: Set<string>
}

/** Max distinct `(mint, keysetId)` pairs fetched per call (ADR-0011 review R3). */
export const DEFAULT_MAX_DLEQ_KEYSETS = 32

/**
 * Detailed variant of {@link fetchDleqKeysetsForBids} that reports WHY an entry
 * is absent (ADR-0011 review R3). A transient failure (network/timeout) leaves
 * the pair absent from both collections — the bid stays `pending`. A terminal
 * failure lands in `unknownKeysets` — the bid is `dleq_invalid`.
 *
 * Bounded: a hand-crafted bid can name an unbounded number of keyset ids, so at
 * most `maxKeysets` distinct pairs are fetched per call; pairs beyond the cap
 * are left absent (pending), never a beacon for attacker-chosen mints.
 */
export const fetchDleqKeysetsForBidsDetailed = async (
	bids: readonly DleqKeysetBidLike[],
	trustedMints: readonly string[],
	fetcher: DleqKeysetFetcher = getMintKeyset,
	options?: { maxKeysets?: number },
): Promise<DleqKeysetAcquisition> => {
	const allowedMints = new Set(trustedMints.map((m) => normalizeMintUrlForKey(m)))
	const keysets = new Map<string, MintKeys>()
	const unknownKeysets = new Set<string>()
	const seen = new Set<string>()
	const maxKeysets = options?.maxKeysets ?? DEFAULT_MAX_DLEQ_KEYSETS
	let fetched = 0

	// Cap prioritisation (review 2026-09-18): the budget is consumed in iteration
	// order, so a flood of crafted keyset ids from a trusted mint could exhaust it
	// before a reserve-meeting (higher-amount) bid's evidence is gathered — that
	// bid would sit `pending`, forcing the seller to the override. Process
	// higher-amount bids first so the cap degrades secondary bids. Stable for
	// equal amounts.
	const orderedBids = [...bids].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))

	for (const bid of orderedBids) {
		if (fetched >= maxKeysets) break
		if (!bid.dleqProofs || bid.dleqProofs.length === 0) continue
		if (!allowedMints.has(normalizeMintUrlForKey(bid.mint))) continue
		for (const proof of bid.dleqProofs) {
			const keysetId = proof?.id
			if (!keysetId) continue
			const key = `${bid.mint}:${keysetId}`
			if (seen.has(key)) continue
			if (fetched >= maxKeysets) break
			seen.add(key)
			fetched++
			try {
				const keyset = await fetcher(bid.mint, keysetId)
				if (keyset) keysets.set(key, keyset)
				else unknownKeysets.add(key)
			} catch (error) {
				if (error instanceof DleqKeysetTerminalError) {
					unknownKeysets.add(key)
				}
				// Transient (network/timeout): leave the pair absent so the bid
				// stays pending — fail-safe, not fail-open.
			}
		}
	}

	return { keysets, unknownKeysets }
}

/**
 * Back-compat wrapper returning only the keyset map. Prefer
 * {@link fetchDleqKeysetsForBidsDetailed} on paths that must distinguish a
 * terminal keyset miss (`dleq_invalid`) from a transient one (`pending`).
 */
export const fetchDleqKeysetsForBids = async (
	bids: readonly DleqKeysetBidLike[],
	trustedMints: readonly string[],
	fetcher: DleqKeysetFetcher = getMintKeyset,
): Promise<Map<string, MintKeys>> => (await fetchDleqKeysetsForBidsDetailed(bids, trustedMints, fetcher)).keysets

/**
 * Normalize a mint URL for key comparison. Mirrors `normalizeMintUrl` from
 * `src/lib/wallet.ts` (trim + strip a single trailing slash) without importing
 * that module (which pulls in wallet/NDK state). The map key must match the
 * `${mint}:${keysetId}` key `computeValidatedBids` builds from `bid.mint`.
 */
const normalizeMintUrlForKey = (url: string): string => {
	const trimmed = url.trim()
	return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}
