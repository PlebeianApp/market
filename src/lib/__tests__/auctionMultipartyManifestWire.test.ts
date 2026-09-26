import { describe, expect, test } from 'bun:test'
import {
	AUCTION_MULTIPARTY_MANIFEST_MAX_BYTES,
	AUCTION_MULTIPARTY_MANIFEST_MAX_ROWS,
	AuctionMultipartyManifestError,
	compileManifest,
	computePathCommitment,
	decodeManifestTag,
	manifestIndexForScheduleIndex,
	type AuctionMultipartyManifestRowInput,
	parseCanonicalManifest,
	scheduleIndexForManifestIndex,
	validateManifestCommitment,
} from '../auction/multipartyManifestWire'

const SELLER = '1'.repeat(64)
const VALIDATOR = '2'.repeat(64)
const V4V = '3'.repeat(64)
const CHILD_A = 'a'.repeat(64)
const CHILD_B = 'b'.repeat(64)
const CHILD_C = 'c'.repeat(64)
const CHILD_D = 'd'.repeat(64)

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const rows = (...entries: AuctionMultipartyManifestRowInput[]): AuctionMultipartyManifestRowInput[] => entries

const sellerRow = (overrides: Partial<AuctionMultipartyManifestRowInput> = {}): AuctionMultipartyManifestRowInput => ({
	role: 'seller',
	recipient_pubkey: SELLER,
	child_pubkey: CHILD_A,
	amount_sats: 928,
	...overrides,
})

const validatorRow = (overrides: Partial<AuctionMultipartyManifestRowInput> = {}): AuctionMultipartyManifestRowInput => ({
	role: 'validator',
	recipient_pubkey: VALIDATOR,
	child_pubkey: CHILD_B,
	amount_sats: 64,
	...overrides,
})

const v4vRow = (overrides: Partial<AuctionMultipartyManifestRowInput> = {}): AuctionMultipartyManifestRowInput => ({
	role: 'v4v',
	recipient_pubkey: V4V,
	child_pubkey: CHILD_C,
	amount_sats: 32,
	...overrides,
})

const codes = (fn: () => unknown): string => {
	try {
		fn()
	} catch (error) {
		return error instanceof AuctionMultipartyManifestError ? error.code : `not_our_error:${String(error)}`
	}
	return 'no_error'
}

const parseCodes = (bytes: Uint8Array): string => {
	try {
		parseCanonicalManifest(bytes)
	} catch (error) {
		return error instanceof AuctionMultipartyManifestError ? error.code : `not_our_error:${String(error)}`
	}
	return 'no_error'
}

const mutateText = (bytes: Uint8Array, fn: (text: string) => string): Uint8Array => utf8Encoder.encode(fn(utf8Decoder.decode(bytes)))

describe('Auction multiparty payout manifest — compilation', () => {
	test('compiles a seller-only manifest and exposes bytes, commitment and tag value', () => {
		const manifest = compileManifest(rows(sellerRow()))
		expect(manifest.rows).toHaveLength(1)
		expect(manifest.rows[0]?.manifest_index).toBe(0)
		expect(manifest.total_amount_sats).toBe(928)
		expect(manifest.manifest_commitment).toMatch(/^[0-9a-f]{64}$/)
		expect(utf8Decoder.decode(manifest.canonical_bytes)).toBe(
			`cashu_p2pk_bidder_path_multiparty_v1\tpayout_manifest\t1\t1\n` + `0\tseller\t${SELLER}\t${CHILD_A}\t928\n`,
		)
		expect(manifest.base64url).not.toContain('=')
	})

	test('compiles seller plus validator and v4v rows in canonical schedule order', () => {
		const manifest = compileManifest(rows(sellerRow(), validatorRow(), v4vRow()))
		expect(manifest.rows.map((row) => row.role)).toEqual(['seller', 'validator', 'v4v'])
		expect(manifest.rows.map((row) => row.manifest_index)).toEqual([0, 1, 2])
		expect(manifest.total_amount_sats).toBe(928 + 64 + 32)
	})

	test('maps the seller to manifest index 0 and schedule entry i to index i + 1', () => {
		expect(manifestIndexForScheduleIndex(0)).toBe(1)
		expect(manifestIndexForScheduleIndex(5)).toBe(6)
		expect(scheduleIndexForManifestIndex(0)).toBeNull()
		expect(scheduleIndexForManifestIndex(1)).toBe(0)
		expect(codes(() => manifestIndexForScheduleIndex(-1))).toBe('manifest_index_noncanonical')
	})

	test('is frozen and deterministic across compilations', () => {
		const first = compileManifest(rows(sellerRow(), validatorRow()))
		const second = compileManifest(rows(sellerRow(), validatorRow()))
		expect(Object.isFrozen(first)).toBe(true)
		expect(first.manifest_commitment).toBe(second.manifest_commitment)
		expect(utf8Decoder.decode(first.canonical_bytes)).toBe(utf8Decoder.decode(second.canonical_bytes))
	})

	test('the commitment changes when any canonical byte changes', () => {
		const base = compileManifest(rows(sellerRow(), validatorRow()))
		const tampered = compileManifest(rows(sellerRow(), validatorRow({ amount_sats: 65 })))
		expect(tampered.manifest_commitment).not.toBe(base.manifest_commitment)
	})

	test('the path commitment is deterministic and domain-separated', () => {
		const path = 'deadbeef'.repeat(4)
		expect(computePathCommitment(path)).toBe(computePathCommitment(path))
		expect(computePathCommitment(path)).not.toBe(computePathCommitment(`${path}f`))
		expect(computePathCommitment(path)).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe('Auction multiparty payout manifest — compilation failures', () => {
	test('rejects an empty manifest', () => {
		expect(codes(() => compileManifest([]))).toBe('manifest_empty')
	})

	test('requires the seller row to be first and to be the only seller', () => {
		expect(codes(() => compileManifest(rows(validatorRow(), sellerRow())))).toBe('manifest_role_seller_not_first')
		expect(codes(() => compileManifest(rows(sellerRow(), validatorRow(), sellerRow({ child_pubkey: CHILD_D }))))).toBe(
			'manifest_role_seller_not_first',
		)
	})

	test('rejects an unknown role', () => {
		expect(codes(() => compileManifest(rows(sellerRow(), { ...validatorRow(), role: 'auditor' as unknown as 'validator' })))).toBe(
			'manifest_role_unknown',
		)
	})

	test('rejects non-canonical recipient and child pubkeys', () => {
		expect(codes(() => compileManifest(rows(sellerRow({ recipient_pubkey: 'a'.repeat(64).toUpperCase() }))))).toBe(
			'manifest_recipient_pubkey_noncanonical',
		)
		expect(codes(() => compileManifest(rows(sellerRow({ recipient_pubkey: 'abc' }))))).toBe('manifest_recipient_pubkey_noncanonical')
		expect(codes(() => compileManifest(rows(sellerRow({ child_pubkey: 'F'.repeat(64) }))))).toBe('manifest_child_pubkey_noncanonical')
	})

	test('rejects zero, negative and fractional amounts', () => {
		expect(codes(() => compileManifest(rows(sellerRow({ amount_sats: 0 }))))).toBe('manifest_amount_not_positive_integer')
		expect(codes(() => compileManifest(rows(sellerRow({ amount_sats: -1 }))))).toBe('manifest_amount_not_positive_integer')
		expect(codes(() => compileManifest(rows(sellerRow({ amount_sats: 1.5 }))))).toBe('manifest_amount_not_positive_integer')
	})

	test('rejects two legs sharing a child key or a recipient', () => {
		expect(codes(() => compileManifest(rows(sellerRow(), validatorRow({ child_pubkey: CHILD_A }))))).toBe('manifest_child_pubkey_reused')
		expect(codes(() => compileManifest(rows(sellerRow(), validatorRow({ recipient_pubkey: SELLER }))))).toBe('manifest_recipient_reused')
	})

	test('rejects auxiliary rows that are not in canonical schedule order', () => {
		expect(codes(() => compileManifest(rows(sellerRow(), v4vRow(), validatorRow({ child_pubkey: CHILD_D }))))).toBe(
			'manifest_row_order_noncanonical',
		)
	})

	test('rejects more rows than the seller plus sixteen entries', () => {
		const many = (count: number) =>
			Array.from({ length: count }, (_, index) => ({
				role: (index === 0 ? 'seller' : 'validator') as AuctionMultipartyManifestRowInput['role'],
				recipient_pubkey: index.toString(16).padStart(64, '0'),
				child_pubkey: (index + 0x100).toString(16).padStart(64, '0'),
				amount_sats: 10,
			}))
		// The limit itself is allowed: one seller plus sixteen entries.
		expect(compileManifest(many(AUCTION_MULTIPARTY_MANIFEST_MAX_ROWS)).rows).toHaveLength(AUCTION_MULTIPARTY_MANIFEST_MAX_ROWS)
		expect(codes(() => compileManifest(many(AUCTION_MULTIPARTY_MANIFEST_MAX_ROWS + 1)))).toBe('manifest_row_count_exceeds_limit')
	})
})

describe('Auction multiparty payout manifest — parsing', () => {
	test('round-trips a compiled manifest', () => {
		const compiled = compileManifest(rows(sellerRow(), validatorRow(), v4vRow()))
		const parsed = parseCanonicalManifest(compiled.canonical_bytes)
		expect(parsed.rows).toEqual(compiled.rows)
		expect(parsed.total_amount_sats).toBe(compiled.total_amount_sats)
		expect(parsed.manifest_commitment).toBe(compiled.manifest_commitment)
		expect(parsed.base64url).toBe(compiled.base64url)
	})

	test('rejects oversized raw bytes before any other failure', () => {
		const oversized = new Uint8Array(AUCTION_MULTIPARTY_MANIFEST_MAX_BYTES + 1).fill(0x41)
		oversized[0] = 0xef // a BOM would also fail, but the byte limit takes precedence
		oversized[1] = 0xbb
		oversized[2] = 0xbf
		expect(parseCodes(oversized)).toBe('manifest_bytes_exceeds_limit')
	})

	test('rejects a BOM, a CR byte and any non-ASCII byte', () => {
		const compiled = compileManifest(rows(sellerRow()))
		const bomPrefixed = new Uint8Array(compiled.canonical_bytes.length + 3)
		bomPrefixed.set([0xef, 0xbb, 0xbf], 0)
		bomPrefixed.set(compiled.canonical_bytes, 3)
		expect(parseCodes(bomPrefixed)).toBe('manifest_bom_forbidden')
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('928', '928\r')))).toBe('manifest_cr_forbidden')
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => `${text.slice(0, -1)}é\n`))).toBe('manifest_non_ascii')
	})

	test('rejects a missing final LF and an empty input', () => {
		const compiled = compileManifest(rows(sellerRow()))
		expect(parseCodes(compiled.canonical_bytes.slice(0, -1))).toBe('manifest_final_lf_missing')
		expect(parseCodes(new Uint8Array())).toBe('manifest_final_lf_missing')
	})

	test('rejects a header with the wrong column count, profile, object or version', () => {
		const compiled = compileManifest(rows(sellerRow()))
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('payout_manifest\t1\t1', 'payout_manifest\t1')))).toBe(
			'manifest_header_column_count_invalid',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('multiparty_v1', 'other_v1')))).toBe(
			'manifest_header_profile_mismatch',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('payout_manifest', 'payout_schedule')))).toBe(
			'manifest_header_object_mismatch',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('payout_manifest\t1\t1', 'payout_manifest\t2\t1')))).toBe(
			'manifest_header_version_unsupported',
		)
	})

	test('rejects a non-canonical or out-of-range row count', () => {
		const compiled = compileManifest(rows(sellerRow()))
		expect(
			parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('payout_manifest\t1\t1', 'payout_manifest\t1\t01'))),
		).toBe('manifest_row_count_noncanonical')
		expect(
			parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('payout_manifest\t1\t1', 'payout_manifest\t1\t18'))),
		).toBe('manifest_row_count_exceeds_limit')
	})

	test('rejects too few rows, a blank row slice and trailing bytes', () => {
		const compiled = compileManifest(rows(sellerRow(), validatorRow()))
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.split('\n').slice(0, 2).join('\n') + '\n'))).toBe(
			'manifest_row_count_mismatch',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace(`1\tvalidator`, `\n1\tvalidator`)))).toBe(
			'manifest_blank_line_forbidden',
		)
		expect(parseCodes(utf8Encoder.encode(`${utf8Decoder.decode(compiled.canonical_bytes)}extra\n`))).toBe('manifest_trailing_bytes')
	})

	test('rejects a row with the wrong column count and non-sequential indexes', () => {
		const compiled = compileManifest(rows(sellerRow(), validatorRow()))
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace(`${CHILD_B}\t64`, CHILD_B)))).toBe(
			'manifest_column_count_invalid',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace(`1\tvalidator`, `2\tvalidator`)))).toBe(
			'manifest_index_not_sequential',
		)
	})

	test('rejects tampered row fields with their specific codes', () => {
		const compiled = compileManifest(rows(sellerRow(), validatorRow()))
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace(`1	validator`, `1	auditor`)))).toBe('manifest_role_unknown')
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace(VALIDATOR, 'abc')))).toBe(
			'manifest_recipient_pubkey_noncanonical',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace(CHILD_B, CHILD_B.toUpperCase())))).toBe(
			'manifest_child_pubkey_noncanonical',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace(CHILD_B, 'zz'.repeat(32))))).toBe(
			'manifest_child_pubkey_noncanonical',
		)
		expect(parseCodes(mutateText(compiled.canonical_bytes, (text) => text.replace('\t64\n', '\t0\n')))).toBe(
			'manifest_amount_not_positive_integer',
		)
	})

	test('rejects a parsed manifest whose auxiliary rows are out of order', () => {
		const compiled = compileManifest(rows(sellerRow(), validatorRow(), v4vRow()))
		const reordered = utf8Decoder.decode(compiled.canonical_bytes).split('\n').filter(Boolean)
		const header = reordered[0]
		const swapped = `${header}\n${reordered[1]}\n${reordered[3]}\n${reordered[2]}\n`
		expect(parseCodes(utf8Encoder.encode(swapped))).toBe('manifest_index_not_sequential')
	})
})

describe('Auction multiparty payout manifest — commitment and tag decoding', () => {
	test('accepts the matching commitment and rejects wrong or malformed ones', () => {
		const compiled = compileManifest(rows(sellerRow()))
		expect(validateManifestCommitment(compiled.canonical_bytes, compiled.manifest_commitment)).toBe(compiled.manifest_commitment)
		expect(codes(() => validateManifestCommitment(compiled.canonical_bytes, 'f'.repeat(64)))).toBe('manifest_commitment_mismatch')
		expect(codes(() => validateManifestCommitment(compiled.canonical_bytes, 'not-hex'))).toBe('manifest_commitment_mismatch')
	})

	test('decodes a payout_manifest tag value back to the canonical bytes, prefix and all', () => {
		const compiled = compileManifest(rows(sellerRow()))
		expect(compiled.tagValue.startsWith('b64u:')).toBe(true)
		expect(decodeManifestTag(compiled.tagValue)).toEqual(compiled.canonical_bytes)
		// A bare payload is not a valid tag value on this wire.
		expect(codes(() => decodeManifestTag(compiled.base64url))).toBe('manifest_tag_value_noncanonical')
		expect(codes(() => decodeManifestTag('b64u:'))).toBe('manifest_tag_value_noncanonical')
	})
})
