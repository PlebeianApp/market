/**
 * Multiparty redemption isolation — one payee, one row, and no way to reach another row.
 *
 * Gate I. The settlement packet leaves §8 open: *"One payee failing (offline, mint down, lost key) must
 * not strand the others. Open: whether each leg is redeemable independently by construction, what the
 * seller/validator does when one leg is never redeemed, and how this interacts with D7 grief."*
 *
 * This module settles the first half — the half that is a **property rather than a policy** — and
 * deliberately stops at the second:
 *
 * - **Isolation holds by construction, and here it is checked rather than assumed.** Each row's value is
 *   P2PK-locked to `derive(payout_xpub, shared_path)` for that row's own xpub, and a row's token carries
 *   only that row's proofs. So a payee can redeem its row without touching another row, and no row's
 *   redemption can move another row's value — provided the token it was handed contains nothing that
 *   belongs to someone else. That is what `verifyMultipartyRowRedemption` refuses: a row token holding a
 *   proof locked to a foreign key, a proof that cannot be reclaimed under the leg's refund authority, an
 *   amount that does not match the row, or a mint that is not the leg's.
 * - **What happens to a leg that is never redeemed is a policy, and it is not decided here.** The
 *   observation in `assessMultipartyLegRedemption` reports what can be known — per row, unspent, spent
 *   or unknown — and refuses to call a leg complete on spent proofs alone, because a spent proof is
 *   ambiguous: the payee redeeming spends it, and so does a bidder reclaiming after the locktime
 *   (`bidValidation.ts` already carries that ambiguity for the single-party case). Completion therefore
 *   needs the payee's own confirmation, which is the settlement packet's §7 and still open.
 *
 * Pure: the derivation and the mint observation are injected, and no token is ever sent anywhere.
 */

import { getDecodedToken, type Proof } from '@cashu/cashu-ts'
import { getAuctionP2pkLockPubkeyFromSecret, toCompressedAuctionP2pkPubkey } from '../auctionP2pk'

const X_ONLY = /^[0-9a-f]{64}$/
const COMPRESSED = /^0[23][0-9a-f]{64}$/

export interface MultipartyRowRedemptionInput {
	readonly manifestIndex: number
	/** The release's row: the child key it names and the token it carries. */
	readonly childPubkey: string
	readonly cashuToken: string
	/** The mint the leg locked at. */
	readonly mintUrl: string
	/** The leg's refund authority — what a row's proofs must be reclaimable under. */
	readonly refundPubkey: string
	/** Sats the manifest records for this row. */
	readonly amountSats: number
	/** The payee's own payout xpub for this mint, and the path the release revealed. */
	readonly payoutXpub: string
	readonly derivationPath: string
	/** The HD derivation, injected — the same helper the release verification uses. */
	readonly derive: (xpub: string, path: string) => string
}

export interface MultipartyRowRedemption {
	readonly manifestIndex: number
	/** The proofs the payee may claim, and only these. */
	readonly proofs: readonly Proof[]
	readonly amountSats: number
	readonly mintUrl: string
	/** The key every proof is locked to — the row's own, which the derivation must reproduce. */
	readonly lockPubkeyCompressed: string
}

export type MultipartyRowRedemptionResult =
	| { readonly ok: true; readonly redemption: MultipartyRowRedemption }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const fail = (code: string, detail: string): MultipartyRowRedemptionResult => ({ ok: false, code, detail })

/**
 * Whether one row can be redeemed by **this** payee, and only by them.
 *
 * Refusals, in the order they matter:
 *
 * - `redemption_row_not_mine` — `derive(payout_xpub, path)` does not reproduce the row's child key, so
 *   the row belongs to another payee. Checked first: everything below assumes the row is ours to hold.
 * - `redemption_row_foreign_proof` — the token holds a proof locked to a key that is not the row's. This
 *   is the isolation violation the module exists for: a row's value reaching beyond its own lock key.
 * - `redemption_row_refund_mismatch` — a proof is not reclaimable under the leg's refund authority, so a
 *   payee who cannot redeem now could not reclaim after the locktime either.
 * - `redemption_row_amount_mismatch` — the proofs do not sum to the manifest's row amount.
 * - `redemption_row_mint_mismatch` — the token is not from the mint the leg locked at.
 */
export const verifyMultipartyRowRedemption = (input: MultipartyRowRedemptionInput): MultipartyRowRedemptionResult => {
	if (!input.childPubkey || !X_ONLY.test(input.childPubkey)) {
		return fail('redemption_row_key_invalid', 'the release row must carry an x-only child key')
	}
	if (!COMPRESSED.test(input.refundPubkey)) {
		return fail('redemption_row_refund_invalid', 'the leg refund authority must be a compressed secp256k1 pubkey')
	}

	let derived: string
	try {
		derived = input.derive(input.payoutXpub, input.derivationPath)
	} catch (error) {
		return fail(
			'redemption_derivation_failed',
			`the payout xpub and the released path do not derive: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
	const derivedXOnly = derived.length === 66 ? derived.slice(2) : derived
	if (derivedXOnly !== input.childPubkey) {
		return fail(
			'redemption_row_not_mine',
			`this payee's xpub derives ${derivedXOnly} for the released path but the row names ${input.childPubkey}; the row belongs to another payee`,
		)
	}

	let decoded: ReturnType<typeof getDecodedToken>
	try {
		decoded = getDecodedToken(input.cashuToken)
	} catch (error) {
		return fail('redemption_token_invalid', `the row token could not be decoded: ${error instanceof Error ? error.message : String(error)}`)
	}
	if (decoded.mint !== input.mintUrl) {
		return fail('redemption_row_mint_mismatch', `the row token is from ${decoded.mint} but the leg locked at ${input.mintUrl}`)
	}
	if (decoded.proofs.length === 0) {
		return fail('redemption_row_no_proofs', 'the row token carries no proofs, so there is nothing to redeem')
	}

	let total = 0
	for (const proof of decoded.proofs) {
		if (!Number.isSafeInteger(proof.amount) || proof.amount <= 0) {
			return fail(
				'redemption_proof_amount_invalid',
				`a proof in row ${input.manifestIndex} carries a non-positive amount (${proof.amount})`,
			)
		}
		let lockKey: string
		try {
			lockKey = toCompressedAuctionP2pkPubkey(getAuctionP2pkLockPubkeyFromSecret(proof.secret))
		} catch (error) {
			return fail(
				'redemption_proof_not_locked',
				`a proof in row ${input.manifestIndex} is not a P2PK lock: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		if (lockKey.slice(2) !== input.childPubkey) {
			return fail(
				'redemption_row_foreign_proof',
				`a proof in row ${input.manifestIndex} is locked to ${lockKey} whose x-only projection is ${lockKey.slice(2)} but the row names ${input.childPubkey}; that value belongs to another row`,
			)
		}
		// The refund tag lives in the same secret as the lock key, so a proof that is ours is also ours
		// to reclaim — checked rather than assumed, because the payee's fallback depends on it.
		if (!secretRefundKeys(proof.secret).some((key) => key.toLowerCase() === input.refundPubkey.toLowerCase())) {
			return fail(
				'redemption_row_refund_mismatch',
				`a proof in row ${input.manifestIndex} is not reclaimable under the leg's refund authority, so this payee could not reclaim after the locktime`,
			)
		}
		total += proof.amount
	}

	if (total !== input.amountSats) {
		return fail(
			'redemption_row_amount_mismatch',
			`row ${input.manifestIndex} carries ${total} sats of redeemable proofs but the manifest records ${input.amountSats}`,
		)
	}

	return {
		ok: true,
		redemption: Object.freeze({
			manifestIndex: input.manifestIndex,
			proofs: Object.freeze([...decoded.proofs]) as readonly Proof[],
			amountSats: total,
			mintUrl: decoded.mint,
			lockPubkeyCompressed: derived.length === 66 ? derived : `02${derived}`,
		}),
	}
}

/** The `refund` tags of a NUT-11 secret — the keys a timelock branch would spend with. */
const secretRefundKeys = (secret: string): string[] => {
	try {
		const parsed = JSON.parse(secret) as unknown
		if (!Array.isArray(parsed) || parsed[0] !== 'P2PK' || typeof parsed[1] !== 'object' || parsed[1] === null) return []
		const tags = (parsed[1] as { tags?: unknown }).tags
		if (!Array.isArray(tags)) return []
		return tags.filter((tag) => Array.isArray(tag) && tag[0] === 'refund').map((tag) => String(tag[1] ?? ''))
	} catch {
		return []
	}
}

/** What the mint says about a proof, as the client's own NUT-07 observation reports it. */
export type MultipartyRedemptionMintState = 'unspent' | 'spent' | 'unknown'

export interface MultipartyLegRedemptionRowInput {
	readonly manifestIndex: number
	/** False for a logical leg with no proofs — the zero-fee case the schedule packet names. */
	readonly proofBearing: boolean
	readonly mintState: MultipartyRedemptionMintState
	/**
	 * The payee's own confirmation, when one exists. Required for completion by design: a spent proof is
	 * ambiguous between a redemption and a post-locktime reclaim.
	 */
	readonly confirmed?: boolean
}

export type MultipartyLegRedemptionState =
	| 'complete'
	| 'spent_awaiting_confirmation'
	| 'partially_spent'
	| 'unredeemed'
	| 'indeterminate'
	| 'nothing_to_redeem'

export interface MultipartyLegRedemptionAssessment {
	readonly state: MultipartyLegRedemptionState
	readonly proofBearingRowCount: number
	readonly spentRowIndexes: readonly number[]
	readonly unspentRowIndexes: readonly number[]
	readonly indeterminateRowIndexes: readonly number[]
	readonly awaitingConfirmationRowIndexes: readonly number[]
}

/**
 * What can be known about a leg's redemption, from NUT-07 observations plus the payees' own
 * confirmations.
 *
 * The rule that matters: **spent is never completion on its own.** A spent proof is ambiguous between
 * the payee redeeming and the bidder reclaiming after the locktime, so `complete` requires both spent
 * observations and confirmations. A leg whose every proof-bearing row is spent but unconfirmed reports
 * `spent_awaiting_confirmation`, which is deliberately not a terminal state.
 *
 * Rows with no proofs — the zero-fee validator case — are excluded from the completion requirements
 * entirely, as the schedule packet requires, and a leg with nothing to redeem reports `nothing_to_redeem`
 * rather than an empty success.
 *
 * What a `spent_awaiting_confirmation` or `partially_spent` leg means for the *seller* — settle, hold, or
 * treat the missing rows as grief — is §8's open policy question and is not decided here.
 */
export const assessMultipartyLegRedemption = (rows: readonly MultipartyLegRedemptionRowInput[]): MultipartyLegRedemptionAssessment => {
	const proofRows = rows.filter((row) => row.proofBearing)
	const spentRowIndexes = proofRows.filter((row) => row.mintState === 'spent').map((row) => row.manifestIndex)
	const unspentRowIndexes = proofRows.filter((row) => row.mintState === 'unspent').map((row) => row.manifestIndex)
	const indeterminateRowIndexes = proofRows.filter((row) => row.mintState === 'unknown').map((row) => row.manifestIndex)
	const awaitingConfirmationRowIndexes = proofRows
		.filter((row) => row.mintState === 'spent' && row.confirmed !== true)
		.map((row) => row.manifestIndex)

	const state: MultipartyLegRedemptionState =
		proofRows.length === 0
			? 'nothing_to_redeem'
			: indeterminateRowIndexes.length > 0
				? 'indeterminate'
				: spentRowIndexes.length === proofRows.length
					? awaitingConfirmationRowIndexes.length === 0
						? 'complete'
						: 'spent_awaiting_confirmation'
					: spentRowIndexes.length === 0
						? 'unredeemed'
						: 'partially_spent'

	return Object.freeze({
		state,
		proofBearingRowCount: proofRows.length,
		spentRowIndexes: Object.freeze(spentRowIndexes) as readonly number[],
		unspentRowIndexes: Object.freeze(unspentRowIndexes) as readonly number[],
		indeterminateRowIndexes: Object.freeze(indeterminateRowIndexes) as readonly number[],
		awaitingConfirmationRowIndexes: Object.freeze(awaitingConfirmationRowIndexes) as readonly number[],
	})
}

/** One shared sentence per state (D14). */
export const describeMultipartyLegRedemption = (assessment: MultipartyLegRedemptionAssessment): string => {
	switch (assessment.state) {
		case 'complete':
			return `All ${assessment.proofBearingRowCount} payable row(s) were redeemed and confirmed.`
		case 'spent_awaiting_confirmation':
			return `${assessment.spentRowIndexes.length} row(s) are spent but unconfirmed; a spent proof can also be a bidder reclaim, so the leg is not complete yet.`
		case 'partially_spent':
			return `${assessment.spentRowIndexes.length} of ${assessment.proofBearingRowCount} payable row(s) are spent; ${assessment.unspentRowIndexes.length} have not been redeemed.`
		case 'unredeemed':
			return `None of the ${assessment.proofBearingRowCount} payable row(s) have been redeemed.`
		case 'indeterminate':
			return `The mint state of ${assessment.indeterminateRowIndexes.length} row(s) is unknown, so redemption cannot be assessed.`
		case 'nothing_to_redeem':
			return 'No row of this leg carries proofs, so there is nothing to redeem.'
	}
}
