/**
 * Multiparty release packet — the kind-1025 release for a leg, written and read.
 *
 * The manifest profile's §4 says what a multiparty release must **additionally** carry: the schedule
 * commitment, the manifest commitment, and the path commitment when the bid made one, so a release
 * cannot be replayed against a different schedule, a different manifest or a different bid
 * (`docs/protocol/auction-multiparty-manifest-v1.md`). What it does not say — because the section
 * predates it — is how a leg's **N child keys and N tokens** travel. That is the decision this module
 * takes and records:
 *
 * ## One release event per bid, with the rows repeated in manifest index order
 *
 * A leg is one bid that locked N outputs, so one release is the natural carrier, and the manifest is
 * already an indexed list: `child_pubkey` and `cashu_token` are emitted once per row, in row order, and
 * a reader matches them positionally against the manifest's rows. Splitting the release across N events
 * would fragment the binding — every event would repeat the same commitments, and a missing one would
 * be indistinguishable from "not released yet" — while a single event makes "all rows are released or
 * none are" a property a reader can check.
 *
 * Consequence, and it is a refusal rather than a best effort: if any `child_pubkey` tags are present
 * there must be **exactly one per manifest row**, and `cashu_token` may be absent entirely or present
 * exactly as often. A release naming three rows of a four-row leg is refused, not partially accepted,
 * because a leg that settles from three rows is a leg that paid three of its four recipients.
 *
 * Pure: no relay, no signature, no derivation. `verifyMultipartyRelease` does the derivation check; this
 * module is the packet that feeds it.
 */

import { AUCTION_PATH_RELEASE_KIND, type PathReleaseReason } from './constants'

const HEX64 = /^[0-9a-f]{64}$/
const X_ONLY = /^[0-9a-f]{64}$/

export const AUCTION_MULTIPARTY_RELEASE_TAGS = {
	bid: 'e',
	coordinate: 'a',
	seller: 'p',
	derivationPath: 'derivation_path',
	childPubkey: 'child_pubkey',
	releaseReason: 'release_reason',
	scheduleCommitment: 'payout_schedule_commitment',
	manifestCommitment: 'payout_manifest_commitment',
	pathCommitment: 'path_commitment',
	cashuToken: 'cashu_token',
	auditorRef: 'auditor_ref',
	fallbackOffer: 'fallback_offer',
} as const

export interface MultipartyReleaseRow {
	/** The row's child key, x-only — the manifest's own form, and what a verifier derives against. */
	readonly childPubkey: string
	/** The encoded Cashu token carrying that row's locked proofs, when the release is redeemable. */
	readonly cashuToken?: string
}

export interface MultipartyReleasePacketInput {
	readonly bidEventId: string
	readonly auctionCoordinate: string
	readonly sellerPubkey: string
	readonly releaseReason: PathReleaseReason
	/** The leg's shared derivation path, revealed by this release. */
	readonly derivationPath: string
	readonly scheduleCommitment: string
	readonly manifestCommitment: string
	/** Required when the bid committed to its path up front (profile §5). */
	readonly pathCommitment?: string
	/** One entry per manifest row, in manifest index order. */
	readonly rows: readonly MultipartyReleaseRow[]
	readonly auditorRefs?: readonly string[]
	readonly fallbackOfferId?: string
}

export interface ParsedMultipartyReleasePacket {
	readonly bidEventId: string
	readonly auctionCoordinate: string
	readonly sellerPubkey: string
	readonly releaseReason: PathReleaseReason
	readonly derivationPath: string
	readonly scheduleCommitment: string
	readonly manifestCommitment: string
	readonly pathCommitment?: string
	readonly rows: readonly MultipartyReleaseRow[]
	readonly auditorRefs: readonly string[]
	readonly fallbackOfferId?: string
}

export type MultipartyReleasePacketResult =
	| { readonly ok: true; readonly tags: readonly (readonly string[])[] }
	| { readonly ok: false; readonly code: string; readonly detail: string }

export type MultipartyReleaseParseResult =
	| { readonly ok: true; readonly packet: ParsedMultipartyReleasePacket }
	| { readonly ok: false; readonly code: string; readonly detail: string }

/**
 * Build the kind-1025 tag set for a multiparty leg.
 *
 * Refusals: a missing bid, coordinate, seller, path or reason; a commitment that is not 64 lowercase
 * hex (a commitment a reader cannot compare is not a commitment); a row whose child key is not x-only,
 * since the manifest records x-only and a verifier derives against x-only; no rows; and a `cashuToken`
 * present on some rows but not others — a release that can redeem some rows and not others is a
 * half-release, and the reader's count rule below would refuse it anyway, so it is refused here first.
 */
export const buildMultipartyReleaseTags = (input: MultipartyReleasePacketInput): MultipartyReleasePacketResult => {
	if (!input.bidEventId?.trim()) return { ok: false, code: 'release_bid_missing', detail: 'a release names the bid it releases' }
	if (!input.auctionCoordinate?.trim())
		return { ok: false, code: 'release_coordinate_missing', detail: 'a release names the auction coordinate' }
	if (!input.sellerPubkey?.trim())
		return { ok: false, code: 'release_seller_missing', detail: 'a release names the seller it is intended for' }
	if (!input.derivationPath?.trim())
		return { ok: false, code: 'release_path_missing', detail: 'a release reveals the shared derivation path' }
	if (!HEX64.test(input.scheduleCommitment)) {
		return { ok: false, code: 'release_schedule_commitment_invalid', detail: 'the schedule commitment must be 64 lowercase hex' }
	}
	if (!HEX64.test(input.manifestCommitment)) {
		return { ok: false, code: 'release_manifest_commitment_invalid', detail: 'the manifest commitment must be 64 lowercase hex' }
	}
	if (input.pathCommitment !== undefined && !HEX64.test(input.pathCommitment)) {
		return { ok: false, code: 'release_path_commitment_invalid', detail: 'the path commitment must be 64 lowercase hex' }
	}
	if (input.rows.length === 0) return { ok: false, code: 'release_rows_empty', detail: 'a multiparty release covers at least one row' }

	const withToken = input.rows.filter((row) => row.cashuToken !== undefined).length
	if (withToken !== 0 && withToken !== input.rows.length) {
		return {
			ok: false,
			code: 'release_tokens_partial',
			detail: `${withToken} of ${input.rows.length} rows carry a token; a release either redeems every row or none`,
		}
	}
	for (const row of input.rows) {
		if (!X_ONLY.test(row.childPubkey)) {
			return {
				ok: false,
				code: 'release_row_key_invalid',
				detail: `a row child key must be the manifest's x-only form; got ${row.childPubkey.length} character(s)`,
			}
		}
	}

	const tags: string[][] = [
		[AUCTION_MULTIPARTY_RELEASE_TAGS.bid, input.bidEventId],
		[AUCTION_MULTIPARTY_RELEASE_TAGS.coordinate, input.auctionCoordinate],
		[AUCTION_MULTIPARTY_RELEASE_TAGS.seller, input.sellerPubkey],
		[AUCTION_MULTIPARTY_RELEASE_TAGS.derivationPath, input.derivationPath],
		[AUCTION_MULTIPARTY_RELEASE_TAGS.releaseReason, input.releaseReason],
		[AUCTION_MULTIPARTY_RELEASE_TAGS.scheduleCommitment, input.scheduleCommitment],
		[AUCTION_MULTIPARTY_RELEASE_TAGS.manifestCommitment, input.manifestCommitment],
	]
	if (input.pathCommitment !== undefined) tags.push([AUCTION_MULTIPARTY_RELEASE_TAGS.pathCommitment, input.pathCommitment])
	for (const ref of input.auditorRefs ?? []) tags.push([AUCTION_MULTIPARTY_RELEASE_TAGS.auditorRef, ref])
	if (input.fallbackOfferId) tags.push([AUCTION_MULTIPARTY_RELEASE_TAGS.fallbackOffer, input.fallbackOfferId])
	// The rows, in manifest index order: one child key per row, and its token when the release is
	// redeemable. Positional matching against the manifest is what makes the order load-bearing.
	for (const row of input.rows) tags.push([AUCTION_MULTIPARTY_RELEASE_TAGS.childPubkey, row.childPubkey])
	if (withToken > 0) {
		for (const row of input.rows) tags.push([AUCTION_MULTIPARTY_RELEASE_TAGS.cashuToken, row.cashuToken as string])
	}

	return { ok: true, tags: Object.freeze(tags) as readonly (readonly string[])[] }
}

const readSingleton = (tags: readonly (readonly string[])[], name: string): string | null => {
	const found = tags.filter((tag) => tag[0] === name)
	if (found.length === 0) return null
	if (found.length > 1) return null
	return found[0][1] ?? null
}

/**
 * Read a kind-1025 tag set back into a packet.
 *
 * Refusals: a singleton tag that is missing or duplicated (two commitments on one release means one of
 * them is decoration); a commitment that is not 64 lowercase hex; a malformed derivation path; no row
 * keys; a child key that is not x-only; and `cashu_token` present a different number of times than
 * `child_pubkey`, which is what makes "every row or no row" checkable rather than assumed.
 */
export const parseMultipartyReleaseTags = (tags: readonly (readonly string[])[]): MultipartyReleaseParseResult => {
	const fail = (code: string, detail: string): MultipartyReleaseParseResult => ({ ok: false, code, detail })

	const bidEventId = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.bid)
	if (!bidEventId) return fail('release_bid_missing', 'the release carries no single bid reference')
	const auctionCoordinate = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.coordinate)
	if (!auctionCoordinate) return fail('release_coordinate_missing', 'the release carries no single auction coordinate')
	const sellerPubkey = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.seller)
	if (!sellerPubkey) return fail('release_seller_missing', 'the release carries no single seller reference')
	const derivationPath = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.derivationPath)
	if (!derivationPath || !/^m(\/\d+)+$/.test(derivationPath.trim())) {
		return fail('release_path_invalid', 'the release carries no single well-formed derivation path')
	}
	const releaseReason = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.releaseReason)
	if (releaseReason !== 'settlement' && releaseReason !== 'fallback_settlement' && releaseReason !== 'voluntary_late') {
		return fail('release_reason_invalid', 'the release carries no single known release reason')
	}
	const scheduleCommitment = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.scheduleCommitment)
	if (!scheduleCommitment || !HEX64.test(scheduleCommitment)) {
		return fail('release_schedule_commitment_invalid', 'the release carries no single 64-lowercase-hex schedule commitment')
	}
	const manifestCommitment = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.manifestCommitment)
	if (!manifestCommitment || !HEX64.test(manifestCommitment)) {
		return fail('release_manifest_commitment_invalid', 'the release carries no single 64-lowercase-hex manifest commitment')
	}
	const pathCommitment = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.pathCommitment)
	if (pathCommitment !== null && !HEX64.test(pathCommitment)) {
		return fail('release_path_commitment_invalid', 'the release carries a malformed path commitment')
	}

	const childPubkeys = tags.filter((tag) => tag[0] === AUCTION_MULTIPARTY_RELEASE_TAGS.childPubkey).map((tag) => tag[1] ?? '')
	if (childPubkeys.length === 0) return fail('release_rows_empty', 'the release names no row child keys')
	for (const key of childPubkeys) {
		if (!X_ONLY.test(key)) return fail('release_row_key_invalid', `a row child key is not x-only (${key.length} character(s))`)
	}

	const tokens = tags.filter((tag) => tag[0] === AUCTION_MULTIPARTY_RELEASE_TAGS.cashuToken).map((tag) => tag[1] ?? '')
	if (tokens.length !== 0 && tokens.length !== childPubkeys.length) {
		return fail(
			'release_tokens_partial',
			`the release carries ${tokens.length} token(s) for ${childPubkeys.length} row(s); a release either redeems every row or none`,
		)
	}

	const rows: MultipartyReleaseRow[] = childPubkeys.map((childPubkey, index) => ({
		childPubkey,
		...(tokens.length === 0 ? {} : { cashuToken: tokens[index] }),
	}))
	const fallbackOfferId = readSingleton(tags, AUCTION_MULTIPARTY_RELEASE_TAGS.fallbackOffer)

	return {
		ok: true,
		packet: Object.freeze({
			bidEventId,
			auctionCoordinate,
			sellerPubkey,
			releaseReason,
			derivationPath: derivationPath.trim(),
			scheduleCommitment,
			manifestCommitment,
			...(pathCommitment === null ? {} : { pathCommitment }),
			rows: Object.freeze(rows) as readonly MultipartyReleaseRow[],
			auditorRefs: Object.freeze(
				tags.filter((tag) => tag[0] === AUCTION_MULTIPARTY_RELEASE_TAGS.auditorRef).map((tag) => tag[1] ?? ''),
			) as readonly string[],
			...(fallbackOfferId === null ? {} : { fallbackOfferId }),
		}),
	}
}

/** What a reader knows independently of the release: the leg it claims to release. */
export interface MultipartyReleaseExpectation {
	readonly bidEventId: string
	readonly scheduleCommitment: string
	readonly manifestCommitment: string
	/** The leg's row count, from the manifest. */
	readonly rowCount: number
	/** When the bid committed to its path up front, the commitment it made. */
	readonly expectedPathCommitment?: string
}

/**
 * Whether a parsed release binds **this** leg and **this** bid — the replay protection the two
 * commitments exist for, checked against values the reader holds rather than values the release
 * carries.
 *
 * Refusals: a different bid, a different schedule or manifest commitment, a row count that disagrees
 * with the manifest, a path commitment the bid made and the release omits, a path commitment the
 * release carries and the bid never made, and a `cashu_token` that appears more than once per row
 * (positional matching assumes one token per row).
 */
export const multipartyReleaseBindsLeg = (
	packet: ParsedMultipartyReleasePacket,
	expectation: MultipartyReleaseExpectation,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string } => {
	if (packet.bidEventId !== expectation.bidEventId) {
		return {
			ok: false,
			code: 'release_bid_mismatch',
			detail: `the release names bid ${packet.bidEventId} but this leg is ${expectation.bidEventId}`,
		}
	}
	if (packet.scheduleCommitment !== expectation.scheduleCommitment) {
		return { ok: false, code: 'release_schedule_commitment_mismatch', detail: 'the release binds a different schedule' }
	}
	if (packet.manifestCommitment !== expectation.manifestCommitment) {
		return { ok: false, code: 'release_manifest_commitment_mismatch', detail: 'the release binds a different manifest' }
	}
	if (packet.rows.length !== expectation.rowCount) {
		return {
			ok: false,
			code: 'release_row_count_mismatch',
			detail: `the release covers ${packet.rows.length} row(s) but the manifest has ${expectation.rowCount}; a leg that settles from some rows pays some recipients`,
		}
	}
	if (expectation.expectedPathCommitment !== undefined && packet.pathCommitment !== expectation.expectedPathCommitment) {
		return { ok: false, code: 'release_path_commitment_mismatch', detail: 'the bid committed to a path and the release does not carry it' }
	}
	if (expectation.expectedPathCommitment === undefined && packet.pathCommitment !== undefined) {
		return { ok: false, code: 'release_path_commitment_unexpected', detail: 'the release carries a path commitment the bid never made' }
	}
	return { ok: true }
}

/** `AUCTION_PATH_RELEASE_KIND`, re-exported so a caller building the event need not import constants. */
export const MULTIPARTY_RELEASE_EVENT_KIND = AUCTION_PATH_RELEASE_KIND
