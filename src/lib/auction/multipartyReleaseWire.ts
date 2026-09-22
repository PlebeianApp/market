/**
 * Auction multiparty release verification (wire packet D2, section 6).
 *
 * The schedule names the recipients, the manifest states which child key each leg
 * was locked to, and the release publishes the shared derivation path. Verification
 * is: for **every** manifest row, `derive(payout_xpub, path) == child_pubkey`.
 *
 * A row whose derivation does not reproduce its child key is **grief** — see
 * `docs/adr/proposals/auction-v4v-participation.md` D7. Verification must cover
 * every row, not only the rows the verifier has an interest in, and a single
 * mismatch is enough to fail the release.
 *
 * Pure: the HD derivation is injected, so this module carries no key material and
 * no I/O. Callers pass the existing single-party derivation helper.
 */

import {
	AUCTION_MULTIPARTY_MANIFEST_COMMITMENT_DOMAIN,
	type AuctionMultipartyCanonicalManifestRow,
	computePathCommitment,
} from './multipartyManifestWire'

export const AUCTION_MULTIPARTY_RELEASE_FAILURE_CODES = [
	'release_rows_empty',
	'release_schedule_commitment_mismatch',
	'release_manifest_commitment_mismatch',
	'release_path_commitment_missing',
	'release_path_commitment_mismatch',
	'release_derivation_mismatch',
] as const

export type AuctionMultipartyReleaseFailure = (typeof AUCTION_MULTIPARTY_RELEASE_FAILURE_CODES)[number]

export interface AuctionMultipartyReleaseBinding {
	/** The shared path published with the release (`derivation_path`). */
	readonly derivationPath: string
	/** The schedule the release claims to settle. */
	readonly scheduleCommitment: string
	/** The manifest the release claims to settle. */
	readonly manifestCommitment: string
	/** Present when the bid committed to its path up front. */
	readonly pathCommitment?: string
}

export interface AuctionMultipartyReleaseVerificationInput {
	readonly rows: readonly AuctionMultipartyCanonicalManifestRow[]
	/** The xpub a row's child key must derive from: the seller's for index 0. */
	readonly payoutXpubForRow: (row: AuctionMultipartyCanonicalManifestRow) => string
	/** Injected HD derivation — pure, no key material held here. */
	readonly deriveChildPubkey: (payoutXpub: string, derivationPath: string) => string
	readonly release: AuctionMultipartyReleaseBinding
	readonly expectedScheduleCommitment: string
	readonly expectedManifestCommitment: string
}

export interface AuctionMultipartyReleaseRowResult {
	readonly manifest_index: number
	readonly recipient_pubkey: string
	readonly expected_child_pubkey: string
	readonly derived_child_pubkey: string
	readonly ok: boolean
}

export interface AuctionMultipartyReleaseVerification {
	/** True only when the binding matches and every row's derivation matches. */
	readonly ok: boolean
	readonly rows: readonly AuctionMultipartyReleaseRowResult[]
	readonly mismatchedIndexes: readonly number[]
	readonly failures: readonly AuctionMultipartyReleaseFailure[]
}

export const verifyMultipartyRelease = (input: AuctionMultipartyReleaseVerificationInput): AuctionMultipartyReleaseVerification => {
	const { rows, release } = input
	const failures = new Set<AuctionMultipartyReleaseFailure>()

	if (rows.length === 0) {
		failures.add('release_rows_empty')
	}
	if (release.scheduleCommitment !== input.expectedScheduleCommitment) {
		failures.add('release_schedule_commitment_mismatch')
	}
	if (release.manifestCommitment !== input.expectedManifestCommitment) {
		failures.add('release_manifest_commitment_mismatch')
	}
	if (release.pathCommitment !== undefined) {
		if (computePathCommitment(release.derivationPath) !== release.pathCommitment) {
			failures.add('release_path_commitment_mismatch')
		}
	}

	const results: AuctionMultipartyReleaseRowResult[] = []
	const mismatchedIndexes: number[] = []

	for (const row of rows) {
		const payoutXpub = input.payoutXpubForRow(row)
		const derived = input.deriveChildPubkey(payoutXpub, release.derivationPath)
		const ok = derived === row.child_pubkey
		if (!ok) {
			mismatchedIndexes.push(row.manifest_index)
			failures.add('release_derivation_mismatch')
		}
		results.push({
			manifest_index: row.manifest_index,
			recipient_pubkey: row.recipient_pubkey,
			expected_child_pubkey: row.child_pubkey,
			derived_child_pubkey: derived,
			ok,
		})
	}

	return Object.freeze({
		ok: failures.size === 0,
		rows: Object.freeze(results),
		mismatchedIndexes: Object.freeze(mismatchedIndexes),
		failures: Object.freeze(Array.from(failures)),
	})
}

/**
 * When a bid committed to its path up front, the release must carry a matching
 * commitment. Kept separate from {@link verifyMultipartyRelease} so the caller can
 * distinguish "no commitment was made" from "a commitment was made and broken".
 */
export const requireCommittedPath = (
	release: AuctionMultipartyReleaseBinding,
	bidPathCommitment: string | undefined,
): AuctionMultipartyReleaseFailure | null => {
	if (bidPathCommitment === undefined) {
		return null
	}
	if (release.pathCommitment === undefined) {
		return 'release_path_commitment_missing'
	}
	// The release must declare the same commitment the bid made, and the published
	// path must hash to it — a release cannot bind one commitment and publish another.
	if (release.pathCommitment !== bidPathCommitment) {
		return 'release_path_commitment_mismatch'
	}
	return computePathCommitment(release.derivationPath) === bidPathCommitment ? null : 'release_path_commitment_mismatch'
}

/** One shared grief wording for the client, the validator service and tests. */
export const describeReleaseGrief = (verification: AuctionMultipartyReleaseVerification): string | null => {
	if (verification.ok) {
		return null
	}
	if (verification.mismatchedIndexes.length > 0) {
		return (
			`The released derivation path does not reproduce the locked child key for ` +
			`${verification.mismatchedIndexes.length} of ${verification.rows.length} payout leg(s) ` +
			`(manifest indexes ${verification.mismatchedIndexes.join(', ')}). The bid does not respect ` +
			'every announced recipient, which is grief.'
		)
	}
	return `The release does not bind to this auction's schedule or manifest (${verification.failures.join(', ')}).`
}
