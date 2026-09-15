import { sha256 } from '@noble/hashes/sha2.js'

export const AUCTION_MULTIPARTY_SETTLEMENT_POLICY = 'cashu_p2pk_bidder_path_multiparty_v1'
export const AUCTION_MULTIPARTY_SCHEDULE_OBJECT = 'payout_schedule'
export const AUCTION_MULTIPARTY_SCHEDULE_VERSION = '1'
export const AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES = 16
export const AUCTION_MULTIPARTY_SCHEDULE_MAX_BYTES = 4096
export const AUCTION_MULTIPARTY_SCHEDULE_COMMITMENT_DOMAIN = 'cashu_p2pk_bidder_path_multiparty_v1:payout_schedule_commitment:v1'

export type AuctionMultipartyScheduleRole = 'validator' | 'v4v'

export interface AuctionMultipartySourceScheduleEntry {
	role: AuctionMultipartyScheduleRole
	recipient_pubkey: string
	payout_capability_event_id: string
	allocation_bps: number
	validator_offer_event_id?: string
}

export interface AuctionMultipartyCanonicalScheduleEntry {
	schedule_index: number
	role: AuctionMultipartyScheduleRole
	recipient_pubkey: string
	payout_capability_event_id: string
	allocation_bps: number
	validator_offer_event_id?: string
}

export interface AuctionMultipartyCanonicalSchedule {
	entries: AuctionMultipartyCanonicalScheduleEntry[]
	auxiliary_allocation_bps: number
	seller_remainder_bps: number
	canonical_bytes: Uint8Array
	commitment_preimage: Uint8Array
	schedule_commitment: string
}

export class AuctionMultipartyScheduleError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyScheduleError'
		this.code = code
	}
}

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const fail = (code: string): never => {
	throw new AuctionMultipartyScheduleError(code)
}

const isCanonicalHex64 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

const isCanonicalUnsignedInteger = (value: string): boolean => value === '0' || /^[1-9][0-9]*$/.test(value)

const roleOrder = (role: AuctionMultipartyScheduleRole): number => (role === 'validator' ? 0 : 1)

const compareCanonicalEntryOrder = (
	left: Pick<AuctionMultipartyCanonicalScheduleEntry, 'role' | 'recipient_pubkey'>,
	right: Pick<AuctionMultipartyCanonicalScheduleEntry, 'role' | 'recipient_pubkey'>,
): number => {
	const roleDifference = roleOrder(left.role) - roleOrder(right.role)
	if (roleDifference !== 0) return roleDifference
	return left.recipient_pubkey < right.recipient_pubkey ? -1 : left.recipient_pubkey > right.recipient_pubkey ? 1 : 0
}

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	const length = parts.reduce((sum, part) => sum + part.length, 0)
	const result = new Uint8Array(length)
	let offset = 0

	for (const part of parts) {
		result.set(part, offset)
		offset += part.length
	}

	return result
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
	if (left.length !== right.length) return false

	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false
	}

	return true
}

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const serializeCanonicalEntries = (entries: AuctionMultipartyCanonicalScheduleEntry[]): Uint8Array => {
	let canonical = `${AUCTION_MULTIPARTY_SETTLEMENT_POLICY}\t${AUCTION_MULTIPARTY_SCHEDULE_OBJECT}\t${AUCTION_MULTIPARTY_SCHEDULE_VERSION}\t${entries.length}\n`

	for (const entry of entries) {
		canonical +=
			`${entry.schedule_index}\t` +
			`${entry.role}\t` +
			`${entry.recipient_pubkey}\t` +
			`${entry.payout_capability_event_id}\t` +
			`${entry.allocation_bps}\t` +
			`${entry.role === 'validator' ? entry.validator_offer_event_id : '-'}\n`
	}

	return utf8Encoder.encode(canonical)
}

const computeCommitmentParts = (
	canonicalBytes: Uint8Array,
): Pick<AuctionMultipartyCanonicalSchedule, 'commitment_preimage' | 'schedule_commitment'> => {
	const commitmentPreimage = concatBytes(
		utf8Encoder.encode(AUCTION_MULTIPARTY_SCHEDULE_COMMITMENT_DOMAIN),
		new Uint8Array([0]),
		canonicalBytes,
	)

	return {
		commitment_preimage: commitmentPreimage,
		schedule_commitment: bytesToHex(sha256(commitmentPreimage)),
	}
}

const buildCanonicalScheduleResult = (
	entries: AuctionMultipartyCanonicalScheduleEntry[],
	canonicalBytes: Uint8Array,
): AuctionMultipartyCanonicalSchedule => {
	const auxiliaryAllocationBps = entries.reduce((sum, entry) => sum + entry.allocation_bps, 0)

	return {
		entries,
		auxiliary_allocation_bps: auxiliaryAllocationBps,
		seller_remainder_bps: 10_000 - auxiliaryAllocationBps,
		canonical_bytes: canonicalBytes,
		...computeCommitmentParts(canonicalBytes),
	}
}

export const compileSourceSchedule = (
	sourceEntries: readonly AuctionMultipartySourceScheduleEntry[],
): AuctionMultipartyCanonicalSchedule => {
	if (sourceEntries.length === 0) {
		fail('schedule_empty')
	}

	if (sourceEntries.length > AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES) {
		fail('schedule_entry_count_exceeds_limit')
	}

	const validatedEntries: Omit<AuctionMultipartyCanonicalScheduleEntry, 'schedule_index'>[] = []

	for (const sourceEntry of sourceEntries) {
		if (sourceEntry.role !== 'validator' && sourceEntry.role !== 'v4v') {
			fail('schedule_role_unknown')
		}

		if (!isCanonicalHex64(sourceEntry.recipient_pubkey)) {
			fail('schedule_recipient_pubkey_noncanonical')
		}

		if (!isCanonicalHex64(sourceEntry.payout_capability_event_id)) {
			fail('schedule_capability_event_id_noncanonical')
		}

		if (!Number.isInteger(sourceEntry.allocation_bps)) {
			fail('schedule_allocation_bps_not_integer')
		}

		if (sourceEntry.role === 'validator') {
			if (!isCanonicalHex64(sourceEntry.validator_offer_event_id)) {
				fail('schedule_validator_offer_missing_or_noncanonical')
			}
		} else if (Object.prototype.hasOwnProperty.call(sourceEntry, 'validator_offer_event_id')) {
			fail('schedule_v4v_offer_forbidden')
		}

		if (sourceEntry.allocation_bps < 0 || sourceEntry.allocation_bps > 10_000) {
			fail('schedule_allocation_bps_out_of_range')
		}

		if (sourceEntry.role === 'v4v' && sourceEntry.allocation_bps === 0) {
			fail('schedule_v4v_zero_allocation')
		}

		validatedEntries.push({
			role: sourceEntry.role,
			recipient_pubkey: sourceEntry.recipient_pubkey,
			payout_capability_event_id: sourceEntry.payout_capability_event_id,
			allocation_bps: sourceEntry.allocation_bps,
			...(sourceEntry.role === 'validator' ? { validator_offer_event_id: sourceEntry.validator_offer_event_id } : {}),
		})
	}

	const roleRecipientKeys = new Set<string>()
	for (const entry of validatedEntries) {
		const key = `${entry.role}:${entry.recipient_pubkey}`
		if (roleRecipientKeys.has(key)) {
			fail('schedule_duplicate_role_recipient')
		}
		roleRecipientKeys.add(key)
	}

	const recipientPubkeys = new Set<string>()
	for (const entry of validatedEntries) {
		if (recipientPubkeys.has(entry.recipient_pubkey)) {
			fail('schedule_recipient_reused_across_roles')
		}
		recipientPubkeys.add(entry.recipient_pubkey)
	}

	const auxiliaryAllocationBps = validatedEntries.reduce((sum, entry) => sum + entry.allocation_bps, 0)
	if (auxiliaryAllocationBps > 10_000) {
		fail('schedule_auxiliary_allocation_exceeds_10000')
	}

	const entries: AuctionMultipartyCanonicalScheduleEntry[] = [...validatedEntries]
		.sort(compareCanonicalEntryOrder)
		.map((entry, scheduleIndex) => ({
			schedule_index: scheduleIndex,
			...entry,
		}))

	const canonicalBytes = serializeCanonicalEntries(entries)
	if (canonicalBytes.length > AUCTION_MULTIPARTY_SCHEDULE_MAX_BYTES) {
		fail('schedule_bytes_exceeds_limit')
	}

	return buildCanonicalScheduleResult(entries, canonicalBytes)
}

interface ParsedWireRow {
	indexRaw: string
	role: AuctionMultipartyScheduleRole
	recipient_pubkey: string
	payout_capability_event_id: string
	allocation_bps: number
	validator_offer_event_id?: string
}

export const parseCanonicalSchedule = (bytes: Uint8Array): AuctionMultipartyCanonicalSchedule => {
	if (bytes.length > AUCTION_MULTIPARTY_SCHEDULE_MAX_BYTES) {
		fail('schedule_bytes_exceeds_limit')
	}

	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		fail('schedule_bom_forbidden')
	}

	for (const byte of bytes) {
		if (byte === 0x0d) {
			fail('schedule_cr_forbidden')
		}
	}

	for (const byte of bytes) {
		if (byte > 0x7f) {
			fail('schedule_non_ascii')
		}
	}

	if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
		fail('schedule_final_lf_missing')
	}

	const firstLf = bytes.indexOf(0x0a)
	const header = utf8Decoder.decode(bytes.slice(0, firstLf))
	const headerColumns = header.split('\t')

	if (headerColumns.length !== 4) {
		fail('schedule_header_column_count_invalid')
	}

	const [profile, objectType, version, entryCountRaw] = headerColumns

	if (profile !== AUCTION_MULTIPARTY_SETTLEMENT_POLICY) {
		fail('schedule_header_profile_mismatch')
	}

	if (objectType !== AUCTION_MULTIPARTY_SCHEDULE_OBJECT) {
		fail('schedule_header_object_mismatch')
	}

	if (version !== AUCTION_MULTIPARTY_SCHEDULE_VERSION) {
		fail('schedule_header_version_unsupported')
	}

	if (!isCanonicalUnsignedInteger(entryCountRaw)) {
		fail('schedule_entry_count_noncanonical')
	}

	if (entryCountRaw === '0') {
		fail('schedule_entry_count_zero')
	}

	if (entryCountRaw.length > 2 || (entryCountRaw.length === 2 && entryCountRaw > '16')) {
		fail('schedule_entry_count_exceeds_limit')
	}

	const entryCount = Number(entryCountRaw)
	const rowSlices: Uint8Array[] = []
	let offset = firstLf + 1

	for (let index = 0; index < entryCount; index++) {
		const nextLf = bytes.indexOf(0x0a, offset)
		if (nextLf === -1) {
			fail('schedule_entry_count_mismatch')
		}

		rowSlices.push(bytes.slice(offset, nextLf))
		offset = nextLf + 1
	}

	for (const rowSlice of rowSlices) {
		if (rowSlice.length === 0) {
			fail('schedule_blank_line_forbidden')
		}
	}

	if (offset !== bytes.length) {
		fail('schedule_trailing_bytes')
	}

	const rowColumns = rowSlices.map((rowSlice) => utf8Decoder.decode(rowSlice).split('\t'))

	for (const columns of rowColumns) {
		if (columns.length !== 6) {
			fail('schedule_column_count_invalid')
		}
	}

	const parsedRows: ParsedWireRow[] = []

	for (const columns of rowColumns) {
		const [indexRaw, roleRaw, recipientPubkey, payoutCapabilityEventId, allocationBpsRaw, validatorOfferRaw] = columns

		if (!isCanonicalUnsignedInteger(indexRaw)) {
			fail('schedule_index_noncanonical')
		}

		if (roleRaw !== 'validator' && roleRaw !== 'v4v') {
			fail('schedule_role_unknown')
		}

		if (!isCanonicalHex64(recipientPubkey)) {
			fail('schedule_recipient_pubkey_noncanonical')
		}

		if (!isCanonicalHex64(payoutCapabilityEventId)) {
			fail('schedule_capability_event_id_noncanonical')
		}

		if (!isCanonicalUnsignedInteger(allocationBpsRaw)) {
			fail('schedule_integer_noncanonical')
		}

		const allocationBpsBig = BigInt(allocationBpsRaw)
		if (allocationBpsBig > 10_000n) {
			fail('schedule_allocation_bps_out_of_range')
		}

		const allocationBps = Number(allocationBpsBig)

		if (roleRaw === 'v4v' && allocationBps === 0) {
			fail('schedule_v4v_zero_allocation')
		}

		if (roleRaw === 'validator') {
			if (!isCanonicalHex64(validatorOfferRaw)) {
				fail('schedule_validator_offer_missing_or_noncanonical')
			}
		} else if (validatorOfferRaw !== '-') {
			fail('schedule_v4v_offer_forbidden')
		}

		parsedRows.push({
			indexRaw,
			role: roleRaw,
			recipient_pubkey: recipientPubkey,
			payout_capability_event_id: payoutCapabilityEventId,
			allocation_bps: allocationBps,
			...(roleRaw === 'validator' ? { validator_offer_event_id: validatorOfferRaw } : {}),
		})
	}

	for (let index = 0; index < parsedRows.length; index++) {
		if (BigInt(parsedRows[index].indexRaw) !== BigInt(index)) {
			fail('schedule_index_not_sequential')
		}
	}

	const roleRecipientKeys = new Set<string>()
	for (const row of parsedRows) {
		const key = `${row.role}:${row.recipient_pubkey}`
		if (roleRecipientKeys.has(key)) {
			fail('schedule_duplicate_role_recipient')
		}
		roleRecipientKeys.add(key)
	}

	const recipientPubkeys = new Set<string>()
	for (const row of parsedRows) {
		if (recipientPubkeys.has(row.recipient_pubkey)) {
			fail('schedule_recipient_reused_across_roles')
		}
		recipientPubkeys.add(row.recipient_pubkey)
	}

	const auxiliaryAllocationBps = parsedRows.reduce((sum, row) => sum + row.allocation_bps, 0)
	if (auxiliaryAllocationBps > 10_000) {
		fail('schedule_auxiliary_allocation_exceeds_10000')
	}

	for (let index = 1; index < parsedRows.length; index++) {
		if (compareCanonicalEntryOrder(parsedRows[index - 1], parsedRows[index]) >= 0) {
			fail('schedule_row_order_noncanonical')
		}
	}

	const entries: AuctionMultipartyCanonicalScheduleEntry[] = parsedRows.map((row, scheduleIndex) => ({
		schedule_index: scheduleIndex,
		role: row.role,
		recipient_pubkey: row.recipient_pubkey,
		payout_capability_event_id: row.payout_capability_event_id,
		allocation_bps: row.allocation_bps,
		...(row.role === 'validator' ? { validator_offer_event_id: row.validator_offer_event_id } : {}),
	}))

	const reserialized = serializeCanonicalEntries(entries)
	if (!bytesEqual(reserialized, bytes)) {
		throw new Error('Auction multiparty schedule parser invariant violated: canonical reserialization mismatch')
	}

	return buildCanonicalScheduleResult(entries, bytes.slice())
}

export const validateScheduleCommitment = (canonicalBytes: Uint8Array, claimedCommitment: string): string => {
	const { schedule_commitment: actualCommitment } = computeCommitmentParts(canonicalBytes)

	if (actualCommitment !== claimedCommitment) {
		fail('schedule_commitment_mismatch')
	}

	return actualCommitment
}
