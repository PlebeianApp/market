/**
 * Auction multiparty payout manifest — canonical codec (wire packet D2).
 *
 * A multiparty bid locks one leg per payout entry. The schedule names the
 * recipients and their allocations; the **manifest** states, for every leg, which
 * child key the funds were locked to. See
 * `docs/protocol/auction-multiparty-manifest-v1.md`.
 *
 * Index space: manifest index 0 is the seller (whose xpub is the root's
 * `p2pk_xpub`); manifest index `i + 1` is canonical schedule entry `i`.
 *
 * Pure: no relay, wallet, Cashu or persistence I/O. Canonical framing mirrors the
 * schedule codec exactly — ASCII subset, TAB and LF, no BOM/CR/blank lines, exact
 * row count, complete-byte consumption, final LF required, fixed byte cap.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlnopad } from '@scure/base'
import { AUCTION_MULTIPARTY_BINARY_TAG_PREFIX } from './multipartyRootTags'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY, AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES } from './multipartySchedule'

export const AUCTION_MULTIPARTY_MANIFEST_OBJECT = 'payout_manifest'
export const AUCTION_MULTIPARTY_MANIFEST_VERSION = '1'
/** One seller row plus at most one row per auxiliary schedule entry. */
export const AUCTION_MULTIPARTY_MANIFEST_MAX_ROWS = 1 + AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES
export const AUCTION_MULTIPARTY_MANIFEST_MAX_BYTES = 4096
export const AUCTION_MULTIPARTY_MANIFEST_COMMITMENT_DOMAIN = 'cashu_p2pk_bidder_path_multiparty_v1:payout_manifest_commitment:v1'
export const AUCTION_MULTIPARTY_PATH_COMMITMENT_DOMAIN = 'cashu_p2pk_bidder_path_multiparty_v1:payout_path_commitment:v1'

export type AuctionMultipartyManifestRole = 'seller' | 'validator' | 'v4v'

export interface AuctionMultipartyManifestRowInput {
	role: AuctionMultipartyManifestRole
	recipient_pubkey: string
	child_pubkey: string
	amount_sats: number
}

export interface AuctionMultipartyCanonicalManifestRow extends AuctionMultipartyManifestRowInput {
	manifest_index: number
}

export interface AuctionMultipartyCanonicalManifest {
	rows: AuctionMultipartyCanonicalManifestRow[]
	total_amount_sats: number
	canonical_bytes: Uint8Array
	manifest_commitment: string
	base64url: string
	/** The full `payout_manifest` tag value, `b64u:` prefix included. */
	tagValue: string
}

export class AuctionMultipartyManifestError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyManifestError'
		this.code = code
	}
}

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const fail = (code: string): never => {
	throw new AuctionMultipartyManifestError(code)
}

const isCanonicalHex64 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/** Indexes may be zero; row counts and amounts may not. */
const isCanonicalNonNegativeInteger = (value: string): boolean => value === '0' || /^[1-9][0-9]*$/.test(value)

const isCanonicalPositiveInteger = (value: string): boolean => /^[1-9][0-9]*$/.test(value)

const isPositiveSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const roleOrder = (role: AuctionMultipartyManifestRole): number => (role === 'seller' ? 0 : role === 'validator' ? 1 : 2)

const comparePubkeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Manifest index 0 is the seller; schedule entry `i` is manifest index `i + 1`. */
export const manifestIndexForScheduleIndex = (scheduleIndex: number): number => {
	if (!Number.isSafeInteger(scheduleIndex) || scheduleIndex < 0) {
		return fail('manifest_index_noncanonical')
	}
	return scheduleIndex + 1
}

/** Inverse of {@link manifestIndexForScheduleIndex}; `null` for the seller row. */
export const scheduleIndexForManifestIndex = (manifestIndex: number): number | null => {
	if (!Number.isSafeInteger(manifestIndex) || manifestIndex < 0) {
		return fail('manifest_index_noncanonical')
	}
	return manifestIndex === 0 ? null : manifestIndex - 1
}

const serializeRows = (rows: readonly AuctionMultipartyCanonicalManifestRow[]): Uint8Array => {
	const header = `${AUCTION_MULTIPARTY_SETTLEMENT_POLICY}\t${AUCTION_MULTIPARTY_MANIFEST_OBJECT}\t${AUCTION_MULTIPARTY_MANIFEST_VERSION}\t${rows.length}\n`
	const body = rows
		.map((row) => `${row.manifest_index}\t${row.role}\t${row.recipient_pubkey}\t${row.child_pubkey}\t${row.amount_sats}\n`)
		.join('')
	return utf8Encoder.encode(header + body)
}

const commitManifestBytes = (canonicalBytes: Uint8Array): string => {
	const preimage = new Uint8Array(utf8Encoder.encode(AUCTION_MULTIPARTY_MANIFEST_COMMITMENT_DOMAIN).length + 1 + canonicalBytes.length)
	const domainBytes = utf8Encoder.encode(AUCTION_MULTIPARTY_MANIFEST_COMMITMENT_DOMAIN)
	preimage.set(domainBytes, 0)
	preimage[domainBytes.length] = 0x00
	preimage.set(canonicalBytes, domainBytes.length + 1)
	return Array.from(sha256(preimage))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

export const computePathCommitment = (derivationPath: string): string => {
	const domainBytes = utf8Encoder.encode(AUCTION_MULTIPARTY_PATH_COMMITMENT_DOMAIN)
	const pathBytes = utf8Encoder.encode(derivationPath)
	const preimage = new Uint8Array(domainBytes.length + 1 + pathBytes.length)
	preimage.set(domainBytes, 0)
	preimage[domainBytes.length] = 0x00
	preimage.set(pathBytes, domainBytes.length + 1)
	return Array.from(sha256(preimage))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

const validateRows = (rows: readonly AuctionMultipartyManifestRowInput[]): AuctionMultipartyCanonicalManifestRow[] => {
	if (rows.length === 0) {
		return fail('manifest_empty')
	}
	if (rows.length > AUCTION_MULTIPARTY_MANIFEST_MAX_ROWS) {
		return fail('manifest_row_count_exceeds_limit')
	}

	const canonical: AuctionMultipartyCanonicalManifestRow[] = []
	const seenChildren = new Set<string>()
	const seenRecipients = new Set<string>()
	let previousRoleOrder = -1
	let previousPubkey = ''

	rows.forEach((row, index) => {
		if (index === 0 && row.role !== 'seller') {
			fail('manifest_role_seller_not_first')
		}
		if (index > 0 && row.role === 'seller') {
			fail('manifest_role_seller_not_first')
		}
		if (row.role !== 'seller' && row.role !== 'validator' && row.role !== 'v4v') {
			fail('manifest_role_unknown')
		}
		if (!isCanonicalHex64(row.recipient_pubkey)) {
			fail('manifest_recipient_pubkey_noncanonical')
		}
		if (!isCanonicalHex64(row.child_pubkey)) {
			fail('manifest_child_pubkey_noncanonical')
		}
		if (!isPositiveSafeInteger(row.amount_sats)) {
			fail('manifest_amount_not_positive_integer')
		}
		if (seenChildren.has(row.child_pubkey)) {
			fail('manifest_child_pubkey_reused')
		}
		if (seenRecipients.has(row.recipient_pubkey)) {
			fail('manifest_recipient_reused')
		}
		// Auxiliary rows follow canonical schedule order: validator before v4v,
		// then ascending recipient pubkey bytes.
		if (index > 0) {
			const order = roleOrder(row.role)
			const outOfOrder =
				order < previousRoleOrder || (order === previousRoleOrder && comparePubkeys(row.recipient_pubkey, previousPubkey) < 0)
			if (outOfOrder) {
				fail('manifest_row_order_noncanonical')
			}
			previousRoleOrder = order
			previousPubkey = row.recipient_pubkey
		}

		seenChildren.add(row.child_pubkey)
		seenRecipients.add(row.recipient_pubkey)
		canonical.push({ manifest_index: index, ...row })
	})

	return canonical
}

export const compileManifest = (rows: readonly AuctionMultipartyManifestRowInput[]): AuctionMultipartyCanonicalManifest => {
	const canonicalRows = validateRows(rows)
	const canonicalBytes = serializeRows(canonicalRows)
	if (canonicalBytes.length > AUCTION_MULTIPARTY_MANIFEST_MAX_BYTES) {
		return fail('manifest_bytes_exceeds_limit')
	}
	return Object.freeze({
		rows: Object.freeze(canonicalRows.map((row) => Object.freeze(row))),
		total_amount_sats: canonicalRows.reduce((total, row) => total + row.amount_sats, 0),
		canonical_bytes: canonicalBytes,
		manifest_commitment: commitManifestBytes(canonicalBytes),
		base64url: base64urlnopad.encode(canonicalBytes),
		// The tag value carries the wire's `b64u:` prefix, exactly as
		// `payout_schedule` does; `base64url` is the bare payload for callers that
		// only need the encoding.
		tagValue: `${AUCTION_MULTIPARTY_BINARY_TAG_PREFIX}${base64urlnopad.encode(canonicalBytes)}`,
	})
}

export const parseCanonicalManifest = (bytes: Uint8Array): AuctionMultipartyCanonicalManifest => {
	// 1-5: framing failures, in the schedule packet's order.
	if (bytes.length > AUCTION_MULTIPARTY_MANIFEST_MAX_BYTES) {
		return fail('manifest_bytes_exceeds_limit')
	}
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return fail('manifest_bom_forbidden')
	}
	for (const byte of bytes) {
		if (byte === 0x0d) {
			return fail('manifest_cr_forbidden')
		}
	}
	for (const byte of bytes) {
		if (byte > 0x7f) {
			return fail('manifest_non_ascii')
		}
	}
	if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
		return fail('manifest_final_lf_missing')
	}

	const text = utf8Decoder.decode(bytes)
	const lines = text.slice(0, -1).split('\n')

	const header = lines[0] ?? ''
	const headerFields = header.split('\t')
	if (headerFields.length !== 4) {
		return fail('manifest_header_column_count_invalid')
	}
	if (headerFields[0] !== AUCTION_MULTIPARTY_SETTLEMENT_POLICY) {
		return fail('manifest_header_profile_mismatch')
	}
	if (headerFields[1] !== AUCTION_MULTIPARTY_MANIFEST_OBJECT) {
		return fail('manifest_header_object_mismatch')
	}
	if (headerFields[2] !== AUCTION_MULTIPARTY_MANIFEST_VERSION) {
		return fail('manifest_header_version_unsupported')
	}

	const declaredCount = headerFields[3] ?? ''
	if (!isCanonicalPositiveInteger(declaredCount)) {
		return fail('manifest_row_count_noncanonical')
	}
	if (declaredCount.length > 2 || Number(declaredCount) > AUCTION_MULTIPARTY_MANIFEST_MAX_ROWS) {
		return fail('manifest_row_count_exceeds_limit')
	}
	const rowCount = Number(declaredCount)

	const rowLines = lines.slice(1)
	if (rowLines.length < rowCount) {
		return fail('manifest_row_count_mismatch')
	}
	if (rowLines.slice(0, rowCount).some((line) => line.length === 0)) {
		return fail('manifest_blank_line_forbidden')
	}
	if (rowLines.length > rowCount) {
		return fail('manifest_trailing_bytes')
	}

	const rows: AuctionMultipartyManifestRowInput[] = []
	for (const line of rowLines) {
		const fields = line.split('\t')
		if (fields.length !== 5) {
			return fail('manifest_column_count_invalid')
		}
		const [indexText, role, recipient, child, amountText] = fields as [string, string, string, string, string]
		if (!isCanonicalNonNegativeInteger(indexText)) {
			return fail('manifest_index_noncanonical')
		}
		if (Number(indexText) !== rows.length) {
			return fail('manifest_index_not_sequential')
		}
		if (role !== 'seller' && role !== 'validator' && role !== 'v4v') {
			return fail('manifest_role_unknown')
		}
		if (!isCanonicalHex64(recipient)) {
			return fail('manifest_recipient_pubkey_noncanonical')
		}
		if (!isCanonicalHex64(child)) {
			return fail('manifest_child_pubkey_noncanonical')
		}
		if (!isCanonicalPositiveInteger(amountText)) {
			return fail('manifest_amount_not_positive_integer')
		}
		rows.push({
			role: role as AuctionMultipartyManifestRole,
			recipient_pubkey: recipient,
			child_pubkey: child,
			amount_sats: Number(amountText),
		})
	}

	const canonicalRows = validateRows(rows)
	const canonicalBytes = serializeRows(canonicalRows)
	// Complete-byte consumption plus a reserialization assertion: a manifest that
	// does not reserialize byte-for-byte is an implementation defect or a reordering
	// attempt, never a distinct wire failure.
	if (utf8Decoder.decode(canonicalBytes) !== text) {
		return fail('manifest_row_order_noncanonical')
	}
	if (canonicalBytes.length > AUCTION_MULTIPARTY_MANIFEST_MAX_BYTES) {
		return fail('manifest_bytes_exceeds_limit')
	}

	return Object.freeze({
		rows: Object.freeze(canonicalRows.map((row) => Object.freeze(row))),
		total_amount_sats: canonicalRows.reduce((total, row) => total + row.amount_sats, 0),
		canonical_bytes: canonicalBytes,
		manifest_commitment: commitManifestBytes(canonicalBytes),
		base64url: base64urlnopad.encode(canonicalBytes),
		// The tag value carries the wire's `b64u:` prefix, exactly as
		// `payout_schedule` does; `base64url` is the bare payload for callers that
		// only need the encoding.
		tagValue: `${AUCTION_MULTIPARTY_BINARY_TAG_PREFIX}${base64urlnopad.encode(canonicalBytes)}`,
	})
}

export const validateManifestCommitment = (canonicalBytes: Uint8Array, claimedCommitment: string): string => {
	if (!isCanonicalHex64(claimedCommitment)) {
		return fail('manifest_commitment_mismatch')
	}
	const computed = commitManifestBytes(canonicalBytes)
	if (computed !== claimedCommitment) {
		return fail('manifest_commitment_mismatch')
	}
	return computed
}

/** Decode a `payout_manifest` tag value into canonical bytes, fail-closed. */
export const decodeManifestTag = (value: string): Uint8Array => {
	if (!value.startsWith(AUCTION_MULTIPARTY_BINARY_TAG_PREFIX)) {
		return fail('manifest_tag_value_noncanonical')
	}
	const payload = value.slice(AUCTION_MULTIPARTY_BINARY_TAG_PREFIX.length)
	if (payload.length === 0) {
		return fail('manifest_tag_value_noncanonical')
	}
	try {
		const bytes = base64urlnopad.decode(payload)
		// Re-encoding must reproduce the payload: a non-canonical encoding is a
		// different value on the wire, so it must not be silently accepted.
		if (base64urlnopad.encode(bytes) !== payload) {
			return fail('manifest_tag_value_noncanonical')
		}
		return bytes
	} catch {
		return fail('manifest_tag_value_noncanonical')
	}
}
