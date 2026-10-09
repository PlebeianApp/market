/**
 * Multiparty settlement attestation — what a validator checks before it may publish a settled verdict.
 *
 * The settlement packet's §9 says it in one paragraph: the three per-row checks (the derivation
 * reproduces `child_pubkey`; the leg's proofs are P2PK-locked to that key; the amounts sum to the
 * released leg total) plus the three commitment matches, **performed for every row**, before publishing
 * a verdict that the auction settled. D7 supplies the reason it is every row: a single unrespected
 * recipient is grief, so a verifier cannot attest only the rows it has an interest in.
 *
 * So this module is the join between four things that already exist and were tested separately — the
 * parsed release packet (`multipartyReleasePacket`), the release binding check (`verifyMultipartyRelease`),
 * the commitment binding (`multipartyReleaseBindsLeg`) and per-row proof inspection — and it produces one
 * value: an **attestation**, per row, with `mayPublishSettledVerdict` false unless every row passes.
 *
 * ## The direction of the key check is not the same as the plan's, and that has a consequence
 *
 * At construction the bidder holds a **compressed** child key, projects it to x-only for the manifest, and
 * can therefore compare the two (D16). At settlement the verifier only has the manifest's x-only key and
 * the proofs' compressed one, so the check here is a **projection**: `proofKey.slice(2)` against
 * `row.child_pubkey`, never a reconstruction — `02 || x` for a key whose y is odd describes a point nobody
 * holds the private key for, and a reconstruction-based check would accept an unspendable proof.
 *
 * **The honest limit: this check is parity-blind, and it cannot be otherwise.** The manifest carries
 * x-only, and a proof locked to the parity twin of the intended key projects to the same value, so a
 * settlement verifier cannot distinguish it from the wire alone. Parity is only knowable where the
 * compressed key is known — at construction — which is why D16's check there is load-bearing and this one
 * complements rather than replaces it. A settlement attestation is therefore evidence that the keys match
 * the manifest, not that they are spendable by the intended recipient.
 *
 * Pure: the derivation is injected, the tokens arrive as data, and nothing here publishes.
 */

import { getDecodedToken, type Proof } from '@cashu/cashu-ts'
import { getAuctionP2pkLockPubkeyFromSecret, toCompressedAuctionP2pkPubkey } from '../auctionP2pk'
import type { AuctionMultipartyCanonicalManifestRow } from './multipartyManifestWire'
import type { ParsedMultipartyReleasePacket } from './multipartyReleasePacket'
import { multipartyReleaseBindsLeg, type MultipartyReleaseExpectation } from './multipartyReleasePacket'
import { verifyMultipartyRelease, type AuctionMultipartyReleaseFailure } from './multipartyReleaseWire'

const X_ONLY = /^[0-9a-f]{64}$/

/** The settlement-side failure codes this module can add to the release codes in manifest §7. */
export const AUCTION_MULTIPARTY_SETTLEMENT_ATTESTATION_CODES = [
	'row_proofs_missing',
	'row_proof_not_locked',
	'row_proof_foreign_key',
	'row_amount_mismatch',
	'row_token_invalid',
	'leg_total_mismatch',
	'settlement_binding_failed',
] as const

export type AuctionMultipartySettlementAttestationCode = (typeof AUCTION_MULTIPARTY_SETTLEMENT_ATTESTATION_CODES)[number]

export interface MultipartySettlementAttestationRow {
	readonly manifestIndex: number
	readonly recipientPubkey: string
	/** The manifest's child key, x-only — what the proofs must project to. */
	readonly childPubkey: string
	/** When present, the row's redeemable value as it arrived (the release's token or a delivery). */
	readonly proofs?: readonly Proof[]
	readonly derivationOk: boolean
	readonly lockOk: boolean
	readonly amountOk: boolean
	readonly proofSats: number
	readonly failures: readonly AuctionMultipartySettlementAttestationCode[]
}

export interface MultipartySettlementAttestation {
	readonly rows: readonly MultipartySettlementAttestationRow[]
	readonly releaseFailures: readonly AuctionMultipartyReleaseFailure[]
	/** The release's binding to this leg: a failure here is fatal on its own. */
	readonly bindingFailure: { readonly code: string; readonly detail: string } | null
	/** Whether the attested rows sum to the leg's released total. */
	readonly legTotalOk: boolean
	readonly settledRowCount: number
	/**
	 * False unless **every** row passed every check. The one rule a caller must not soften: a verdict that
	 * the auction settled may only be published from an attestation where this is true.
	 */
	readonly mayPublishSettledVerdict: boolean
	readonly mismatchedIndexes: readonly number[]
}

export interface MultipartySettlementAttestationInput {
	readonly packet: ParsedMultipartyReleasePacket
	readonly manifestRows: readonly AuctionMultipartyCanonicalManifestRow[]
	/** The xpub a row's child key must derive from: the seller's for index 0, the entry's otherwise. */
	readonly payoutXpubForRow: (row: AuctionMultipartyCanonicalManifestRow) => string
	/** Injected HD derivation. */
	readonly deriveChildPubkey: (payoutXpub: string, derivationPath: string) => string
	readonly expectation: MultipartyReleaseExpectation
	/** The row's proofs, keyed by manifest index — the release's tokens, or a delivery's payload. */
	readonly proofsForRow?: (row: AuctionMultipartyCanonicalManifestRow) => readonly Proof[] | undefined
	/**
	 * The leg's released total, from the bid that locked it. When supplied, the attested rows must sum to
	 * it — that is §9's "amounts sum to the released leg total", and it is the check that catches a
	 * manifest whose rows do not add up to what was actually locked.
	 */
	readonly expectedLegTotalSats?: number
}

const attest = (input: MultipartySettlementAttestationInput): MultipartySettlementAttestation => {
	const binding = multipartyReleaseBindsLeg(input.packet, input.expectation)
	const release = verifyMultipartyRelease({
		rows: input.manifestRows,
		payoutXpubForRow: input.payoutXpubForRow,
		deriveChildPubkey: input.deriveChildPubkey,
		release: {
			derivationPath: input.packet.derivationPath,
			scheduleCommitment: input.packet.scheduleCommitment,
			manifestCommitment: input.packet.manifestCommitment,
			...(input.packet.pathCommitment === undefined ? {} : { pathCommitment: input.packet.pathCommitment }),
		},
		expectedScheduleCommitment: input.expectation.scheduleCommitment,
		expectedManifestCommitment: input.expectation.manifestCommitment,
	})

	const derivationByIndex = new Map(release.rows.map((row) => [row.manifest_index, row.ok]))
	const rows: MultipartySettlementAttestationRow[] = input.manifestRows.map((row) => {
		const failures: AuctionMultipartySettlementAttestationCode[] = []
		const derivationOk = derivationByIndex.get(row.manifest_index) === true
		const proofs = input.proofsForRow?.(row)

		let lockOk = false
		let amountOk = false
		let proofSats = 0

		if (proofs === undefined) {
			// A row whose proofs never arrived cannot be attested. Absence is not a pass: the verifier must
			// be able to say "not yet", and D7's rule is that only a fully attested leg may settle.
			failures.push('row_proofs_missing')
		} else if (proofs.length === 0) {
			failures.push('row_proofs_missing')
		} else {
			lockOk = true
			for (const proof of proofs) {
				let proofKey: string
				try {
					proofKey = toCompressedAuctionP2pkPubkey(getAuctionP2pkLockPubkeyFromSecret(proof.secret))
				} catch {
					failures.push('row_proof_not_locked')
					lockOk = false
					break
				}
				// Projection, never reconstruction: the manifest is x-only and the proof is compressed.
				if (proofKey.slice(2) !== row.child_pubkey) {
					failures.push('row_proof_foreign_key')
					lockOk = false
					break
				}
				if (!Number.isSafeInteger(proof.amount) || proof.amount <= 0) {
					failures.push('row_amount_mismatch')
					lockOk = false
					break
				}
				proofSats += proof.amount
			}
			amountOk = lockOk && proofSats === row.amount_sats
			if (lockOk && !amountOk) failures.push('row_amount_mismatch')
		}

		return Object.freeze({
			manifestIndex: row.manifest_index,
			recipientPubkey: row.recipient_pubkey,
			childPubkey: row.child_pubkey,
			...(proofs === undefined ? {} : { proofs: Object.freeze([...proofs]) as readonly Proof[] }),
			derivationOk,
			lockOk,
			amountOk,
			proofSats,
			failures: Object.freeze(failures) as readonly AuctionMultipartySettlementAttestationCode[],
		})
	})

	// The leg total: the attested rows must sum to the leg's released total when the caller knows it, and
	// to the manifest's own row sum otherwise. A release that attests every row but with different amounts
	// is the same failure one level up.
	const manifestTotal = input.manifestRows.reduce((sum, row) => sum + row.amount_sats, 0)
	const expectedTotal = input.expectedLegTotalSats ?? manifestTotal
	const attestedTotal = rows.reduce((sum, row) => sum + (row.lockOk && row.amountOk ? row.proofSats : 0), 0)
	const attestedEveryRow = rows.every((row) => row.derivationOk && row.lockOk && row.amountOk)
	const legTotalOk = attestedEveryRow && attestedTotal === expectedTotal

	const releaseFailures = release.failures
	const settledRowCount = rows.filter((row) => row.derivationOk && row.lockOk && row.amountOk).length
	const mismatchedIndexes = rows.filter((row) => !(row.derivationOk && row.lockOk && row.amountOk)).map((row) => row.manifestIndex)
	const bindingFailure = binding.ok ? null : { code: binding.code, detail: binding.detail }

	return Object.freeze({
		rows: Object.freeze(rows) as readonly MultipartySettlementAttestationRow[],
		releaseFailures,
		bindingFailure,
		legTotalOk,
		settledRowCount,
		mayPublishSettledVerdict: binding.ok && release.ok && attestedEveryRow && legTotalOk,
		mismatchedIndexes: Object.freeze(mismatchedIndexes) as readonly number[],
	})
}

/**
 * Attest a multiparty settlement: the binding, the per-row derivation, the per-row lock and amount, and
 * the leg total — for **every** row.
 *
 * A refusal here is not an error to retry: it is the statement that the leg is not attested, which is
 * what a validator must have before it publishes a settled verdict. The distinct reasons let a caller
 * distinguish grief (a row locked to a key its derivation does not reproduce — D7) from absence (a row's
 * proofs never arrived) and from a mismatch one level up (the leg total).
 */
export const attestMultipartySettlement = (input: MultipartySettlementAttestationInput): MultipartySettlementAttestation => attest(input)

/** The leg total check, exposed so a caller can report it without re-deriving the attestation. */
export const multipartySettlementLegTotalOk = (attestation: MultipartySettlementAttestation): boolean =>
	attestation.rows.every((row) => row.derivationOk && row.lockOk && row.amountOk)

/** Decode a row's token into proofs, for a caller that received the release's `cashu_token` tags. */
export const proofsFromRowToken = (token: string): readonly Proof[] | undefined => {
	try {
		return getDecodedToken(token).proofs
	} catch {
		return undefined
	}
}

/** Whether a manifest child key is in the form the projection check requires. */
export const isAttestableChildKey = (childPubkey: string): boolean => X_ONLY.test(childPubkey)
