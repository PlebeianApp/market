/**
 * Multiparty pre-lock recovery record — every row of a leg, under one refund authority.
 *
 * The single-party recovery record (`bidderRecords.ts`) is the durable copy of a leg's refund
 * private key, written with confirmed-write semantics **before** the mint call that can consume
 * inputs. A multiparty leg needs strictly more than that, because its construction is one swap per
 * row (D16): the failure this record has to survive is not "the mint may have locked my one output"
 * but "the mint may have locked rows 0..k and failed at row k+1". What has to be recoverable is
 * therefore *which* rows exist, each row's compressed lock key, its x-only projection, its
 * derivation path and its amount — all under the leg's single refund key, which is the same on every
 * row.
 *
 * ## Why a separate store, and why that is not duplication
 *
 * The single-party record is keyed by refund pubkey and holds exactly one row. Widening it in place
 * would change a live, money-critical shape (its readers include the reclaim flow), so the
 * multiparty variant lives beside it: its own storage key, its own type, its own bound. The lookup
 * key is still the leg's refund pubkey, because the refund authority is still per leg.
 *
 * ## Two guarantees, matching the single-party record
 *
 * - **Confirmed write.** `persistMultipartyPreLockRecoveryRecord` writes strictly and then reads
 *   back, requiring the record to deep-equal what was intended. Any throw or mismatch propagates:
 *   the caller must treat the record as NOT durably present and must not send the first swap.
 * - **Fail closed at the bound, never evict.** Each record is the only durable copy of its leg's
 *   refund key. A new key that would push the store past the bound throws *before* the write; a
 *   supersede of an existing key keeps the count unchanged and still succeeds.
 *
 * Persistence is user-scoped (the existing wallet/storage helpers), so switching identities does not
 * bleed bid state across users.
 */

import { loadUserData, saveUserData, type SaveUserDataOptions } from '../wallet/storage'

/** Its own namespace: the single-party store's readers must not have to understand a new shape. */
const MULTIPARTY_PRE_LOCK_RECOVERY_RECORDS_KEY = 'auction_bid_pre_lock_recovery_multiparty_v1'

/** Same bound as the single-party store, and for the same reason. */
const MULTIPARTY_PRE_LOCK_RECOVERY_RECORDS_MAX_ENTRIES = 25

const COMPRESSED = /^0[23][0-9a-f]{64}$/
const X_ONLY = /^[0-9a-f]{64}$/
const PRIVATE_KEY_HEX = /^[0-9a-f]{64}$/

export interface AuctionMultipartyLegRecoveryRow {
	readonly manifestIndex: number
	/**
	 * The derived child key, **compressed** — the key the row's output is locked to, and the only
	 * form that carries the parity. A record that lost the parity byte could not re-verify a lock,
	 * which is why the compressed form is what is stored and the x-only form is stored beside it.
	 */
	readonly childPubkeyCompressed: string
	/** The same key as the manifest carries it — kept so a recovered record can be matched to the manifest. */
	readonly childPubkeyXOnly: string
	/** The entry's payout xpub-relative path, when the row has one of its own. */
	readonly derivationPath?: string
	/** Sats this row locks. The rows sum to the leg's delta. */
	readonly amountSats: number
}

export interface AuctionMultipartyPreLockRecoveryRecord {
	/** Locally generated record id (uuid). */
	readonly id: string
	readonly createdAt: number
	readonly scheme: 'cashu_p2pk_bidder_path_multiparty_v1'
	readonly auctionEventId: string
	readonly auctionCoordinates: string
	readonly sellerPubkey: string
	/** The leg's shared derivation path (D8: one shared path, per-recipient xpub). */
	readonly derivationPath: string
	readonly refundPubkey: string
	/** The recovery authority this record protects. */
	readonly refundPrivateKey: string
	readonly mintUrl: string
	/** Sats this leg locks — the delta, not the cumulative bid. */
	readonly legDeltaSats: number
	readonly cumulativeAmountSats: number
	readonly locktime: number
	readonly prevBidEventId: string | null
	readonly rows: readonly AuctionMultipartyLegRecoveryRow[]
}

export type BuildMultipartyPreLockRecoveryRecordInput = Omit<AuctionMultipartyPreLockRecoveryRecord, 'scheme'>

export type MultipartyRecoveryRecordResult =
	| { readonly ok: true; readonly record: AuctionMultipartyPreLockRecoveryRecord }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const fail = (code: string, detail: string): MultipartyRecoveryRecordResult => ({ ok: false, code, detail })

const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/**
 * Build a multiparty recovery record, refusing any shape that could not be used to recover the leg.
 *
 * Refusals: no rows; manifest indexes that are not `0..n-1` in order; a row key that is not
 * compressed, or whose stored x-only projection is not that key's own projection (a record whose
 * projection disagrees with its key would validate the wrong thing after a crash); a reused child
 * key; a non-positive row amount; row amounts that do not sum to the leg delta (the record could not
 * be matched back to a manifest); an uncompressed refund key or a malformed refund private key; a
 * non-positive locktime or leg delta; and the identity fields a recovery would need to name its leg.
 *
 * `createdAt` may be 0 — the caller stamps it, and a record built in a test is not less valid for it.
 */
export const buildMultipartyPreLockRecoveryRecord = (input: BuildMultipartyPreLockRecoveryRecordInput): MultipartyRecoveryRecordResult => {
	if (!input.id?.trim()) return fail('record_id_missing', 'the record needs a local id')
	if (!isNonNegativeInteger(input.createdAt))
		return fail('record_created_at_invalid', `createdAt must be a non-negative integer; got ${input.createdAt}`)
	if (!input.auctionEventId?.trim()) return fail('record_auction_event_missing', 'the record needs the auction root event id')
	if (!input.auctionCoordinates?.trim()) return fail('record_auction_coordinates_missing', 'the record needs the auction coordinate')
	if (!input.sellerPubkey?.trim()) return fail('record_seller_pubkey_missing', 'the record needs the seller pubkey')
	if (!input.derivationPath?.trim()) return fail('record_derivation_path_missing', 'the record needs the leg derivation path')
	if (!COMPRESSED.test(input.refundPubkey)) {
		return fail('record_refund_pubkey_invalid', 'the refund key must be a compressed secp256k1 pubkey (02/03 + 64 hex)')
	}
	if (!PRIVATE_KEY_HEX.test(input.refundPrivateKey)) {
		return fail(
			'record_refund_privkey_invalid',
			'the refund private key must be 32 bytes of lowercase hex — without it the leg is not even timelock-reclaimable',
		)
	}
	if (!input.mintUrl?.trim()) return fail('record_mint_missing', 'the record needs the mint the leg locks at')
	if (!isPositiveInteger(input.legDeltaSats))
		return fail('record_leg_delta_invalid', `the leg delta must be a positive integer; got ${input.legDeltaSats}`)
	if (!isNonNegativeInteger(input.cumulativeAmountSats)) {
		return fail(
			'record_cumulative_amount_invalid',
			`the cumulative amount must be a non-negative integer; got ${input.cumulativeAmountSats}`,
		)
	}
	if (!isPositiveInteger(input.locktime))
		return fail('record_locktime_invalid', `the locktime must be a positive integer; got ${input.locktime}`)
	if (input.rows.length === 0) return fail('record_rows_empty', 'a multiparty leg has at least one row')

	const indexes = input.rows.map((row) => row.manifestIndex)
	if (indexes.some((index, position) => index !== position)) {
		return fail('record_rows_indexes_noncontiguous', `row indexes must be 0..n-1 in order; got [${indexes.join(', ')}]`)
	}

	const seenKeys = new Set<string>()
	let rowTotal = 0
	for (const row of input.rows) {
		if (!COMPRESSED.test(row.childPubkeyCompressed)) {
			return fail(
				'record_row_key_not_compressed',
				`row ${row.manifestIndex} does not carry a compressed child key; the parity cannot be rebuilt from x-only`,
			)
		}
		if (!X_ONLY.test(row.childPubkeyXOnly)) {
			return fail('record_row_xonly_invalid', `row ${row.manifestIndex} carries a malformed x-only child key`)
		}
		if (row.childPubkeyXOnly !== row.childPubkeyCompressed.slice(2)) {
			return fail(
				'record_row_xonly_mismatch',
				`row ${row.manifestIndex} records x-only ${row.childPubkeyXOnly} but its compressed key projects to ${row.childPubkeyCompressed.slice(2)}`,
			)
		}
		if (seenKeys.has(row.childPubkeyXOnly)) {
			return fail('record_row_key_reused', `row ${row.manifestIndex} reuses child key ${row.childPubkeyXOnly.slice(0, 12)}…`)
		}
		seenKeys.add(row.childPubkeyXOnly)
		if (!isPositiveInteger(row.amountSats)) {
			return fail('record_row_amount_invalid', `row ${row.manifestIndex} must carry a positive integer amount; got ${row.amountSats}`)
		}
		rowTotal += row.amountSats
	}

	if (rowTotal !== input.legDeltaSats) {
		return fail(
			'record_rows_sum_mismatch',
			`the rows sum to ${rowTotal} sats but the leg locks ${input.legDeltaSats}; a recovered record could not be matched to its manifest`,
		)
	}

	return {
		ok: true,
		record: Object.freeze({
			...input,
			scheme: 'cashu_p2pk_bidder_path_multiparty_v1' as const,
			rows: Object.freeze(input.rows.map((row) => Object.freeze({ ...row }))) as readonly AuctionMultipartyLegRecoveryRow[],
		}),
	}
}

export interface ManifestRowForRecoveryCheck {
	readonly manifest_index: number
	/** The manifest's child key, x-only. */
	readonly child_pubkey: string
	readonly amount_sats: number
}

export type MultipartyRecoveryRecordManifestCheck =
	| { readonly ok: true }
	| { readonly ok: false; readonly code: string; readonly detail: string }

/**
 * Whether a (possibly crash-recovered) record still describes the manifest it was built from, row by
 * row: same count, same indexes, same x-only child keys, same amounts.
 *
 * This is not the release check — it proves the record matches **the manifest**, not that a key
 * derives from an xpub. It exists because a record is read back days later, and re-locking or
 * reclaiming against a manifest that has moved would spend a fee on the wrong thing.
 */
export const multipartyRecoveryRecordMatchesManifest = (
	record: AuctionMultipartyPreLockRecoveryRecord,
	manifestRows: readonly ManifestRowForRecoveryCheck[],
): MultipartyRecoveryRecordManifestCheck => {
	if (record.rows.length !== manifestRows.length) {
		return {
			ok: false,
			code: 'record_manifest_row_count_mismatch',
			detail: `the record carries ${record.rows.length} row(s) but the manifest has ${manifestRows.length}`,
		}
	}
	for (const [position, manifestRow] of manifestRows.entries()) {
		const row = record.rows[position]
		if (row.manifestIndex !== manifestRow.manifest_index) {
			return {
				ok: false,
				code: 'record_manifest_index_mismatch',
				detail: `position ${position} is row ${row.manifestIndex} in the record and row ${manifestRow.manifest_index} in the manifest`,
			}
		}
		if (row.childPubkeyXOnly !== manifestRow.child_pubkey) {
			return {
				ok: false,
				code: 'record_manifest_child_key_mismatch',
				detail: `row ${row.manifestIndex} records ${row.childPubkeyXOnly} but the manifest carries ${manifestRow.child_pubkey}`,
			}
		}
		if (row.amountSats !== manifestRow.amount_sats) {
			return {
				ok: false,
				code: 'record_manifest_amount_mismatch',
				detail: `row ${row.manifestIndex} records ${row.amountSats} sats but the manifest carries ${manifestRow.amount_sats}`,
			}
		}
	}
	return { ok: true }
}

type MultipartyRecordMap = Record<string, AuctionMultipartyPreLockRecoveryRecord>

export const loadMultipartyPreLockRecoveryRecords = (): MultipartyRecordMap =>
	loadUserData<MultipartyRecordMap>(MULTIPARTY_PRE_LOCK_RECOVERY_RECORDS_KEY, {})

const persistMultipartyPreLockRecoveryRecordMap = (map: MultipartyRecordMap): void => {
	// Fail closed at the bound, never evict — see the module comment. The throw happens before the
	// write, so a caller that aborts on it has locked nothing.
	if (Object.keys(map).length > MULTIPARTY_PRE_LOCK_RECOVERY_RECORDS_MAX_ENTRIES) {
		throw new Error(
			`Multiparty pre-lock recovery record store is full (${MULTIPARTY_PRE_LOCK_RECOVERY_RECORDS_MAX_ENTRIES} entries) — ` +
				'refusing to persist a NEW record instead of evicting an existing one. Each record is the only durable copy of a ' +
				"pending leg's refund key (and of its rows). Nothing was locked; re-submitting once the store has room is safe.",
		)
	}
	saveUserData(MULTIPARTY_PRE_LOCK_RECOVERY_RECORDS_KEY, map, { strict: true })
}

/**
 * Persist a multiparty recovery record with CONFIRMED-WRITE semantics.
 *
 * Confirmed means: the strict save succeeded **and** a read-back deep-equals what was intended. Any
 * throw or mismatch propagates, and the caller must not send the first swap of the leg.
 */
export const persistMultipartyPreLockRecoveryRecord = (record: AuctionMultipartyPreLockRecoveryRecord): void => {
	const map = { ...loadMultipartyPreLockRecoveryRecords() }
	// Lowercase hex keys, matching the single-party store's normalization.
	map[record.refundPubkey.trim().toLowerCase()] = record
	persistMultipartyPreLockRecoveryRecordMap(map)

	const readBack = loadMultipartyPreLockRecoveryRecords()[record.refundPubkey.trim().toLowerCase()]
	if (!readBack || JSON.stringify(readBack) !== JSON.stringify(record)) {
		throw new Error(
			`Failed to confirm the multiparty pre-lock recovery record write for refund pubkey ${record.refundPubkey} ` +
				'(read-back mismatch — the record is not durably present).',
		)
	}
}

export const findMultipartyPreLockRecoveryRecordByRefundPubkey = (
	refundPubkey: string,
): AuctionMultipartyPreLockRecoveryRecord | undefined => {
	const needle = refundPubkey.trim().toLowerCase()
	if (!needle) return undefined
	return loadMultipartyPreLockRecoveryRecords()[needle]
}

/**
 * Removal is best-effort, exactly as in the single-party store: a failed removal leaves a stale
 * record behind, which is harmless for money safety (it is superseded by the full bidder record, or
 * by a provably-pre-mint failure) and is still a valid refund authority if it is ever used.
 */
export const removeMultipartyPreLockRecoveryRecord = (refundPubkey: string, options?: SaveUserDataOptions): void => {
	const map = { ...loadMultipartyPreLockRecoveryRecords() }
	const key = refundPubkey.trim().toLowerCase()
	if (!(key in map)) return
	delete map[key]
	saveUserData(MULTIPARTY_PRE_LOCK_RECOVERY_RECORDS_KEY, map, options)
}
