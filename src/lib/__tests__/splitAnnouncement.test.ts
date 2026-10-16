import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { ALLOCATION_TOTAL_BPS } from '../v4v/allocations'
import {
	announceV4VSplit,
	canonicalSplitBytes,
	canonicalSplitRows,
	SPLIT_COMMITMENT_ENCODING,
	SPLIT_MAX_ROWS,
	splitCommitment,
	splitMatchesCommitment,
	type V4VSplitRow,
} from '../v4v/splitAnnouncement'

const row = (id: string, destination: string, bps: number, name?: string): V4VSplitRow => ({ id, destination, bps, name })

describe('the canonical encoding is deterministic in meaning, not in order', () => {
	test('row order does not change the commitment', () => {
		const a = [row('1', 'alice@example.com', 500), row('2', 'bob@example.com', 250)]
		const b = [row('2', 'bob@example.com', 250), row('1', 'alice@example.com', 500)]
		expect(splitCommitment(a)).toBe(splitCommitment(b))
	})

	test('spelling does not change the commitment', () => {
		const a = [row('1', 'Alice@Example.com', 500)]
		const b = [row('1', ' alice@example.com ', 500)]
		expect(splitCommitment(a)).toBe(splitCommitment(b))
	})

	test('a label change does NOT change the commitment — a typo fix must not invalidate a commitment', () => {
		const a = [row('1', 'alice@example.com', 500, 'Alice')]
		const b = [row('1', 'alice@example.com', 500, 'Alice (charity)')]
		expect(splitCommitment(a)).toBe(splitCommitment(b))
	})

	test('a share change DOES change the commitment', () => {
		expect(splitCommitment([row('1', 'alice@example.com', 500)])).not.toBe(splitCommitment([row('1', 'alice@example.com', 501)]))
	})

	test('a destination change DOES change the commitment', () => {
		expect(splitCommitment([row('1', 'alice@example.com', 500)])).not.toBe(splitCommitment([row('1', 'bob@example.com', 500)]))
	})

	test('the rows are sorted by destination, and the version line comes first', () => {
		const rows = [row('1', 'zoe@example.com', 100), row('2', 'alice@example.com', 200)]
		expect(canonicalSplitRows(rows)).toEqual(['alice@example.com\t200', 'zoe@example.com\t100'])
		expect(canonicalSplitBytes(rows).split('\n')[0]).toBe(SPLIT_COMMITMENT_ENCODING)
	})

	test('the commitment is the sha256 of the documented bytes', () => {
		const rows = [row('1', 'alice@example.com', 500)]
		const expected = Array.from(sha256(new TextEncoder().encode(canonicalSplitBytes(rows))))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('')
		expect(splitCommitment(rows)).toBe(expected)
		expect(splitCommitment(rows)).toHaveLength(64)
	})

	test('an empty split commits to something stable rather than throwing', () => {
		expect(() => splitCommitment([])).not.toThrow()
		expect(splitCommitment([])).toBe(splitCommitment([]))
	})
})

describe('announceV4VSplit — what a seller may announce', () => {
	test('a valid split reports its total, its commitment and the seller remainder', () => {
		const result = announceV4VSplit([row('1', 'alice@example.com', 500), row('2', 'bob@example.com', 250)])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.announcement.totalBps).toBe(750)
		expect(result.announcement.sellerBps).toBe(ALLOCATION_TOTAL_BPS - 750)
		expect(result.announcement.commitment).toBe(splitCommitment([row('1', 'alice@example.com', 500), row('2', 'bob@example.com', 250)]))
		expect(result.announcement.encoding).toBe(SPLIT_COMMITMENT_ENCODING)
	})

	test('a full split leaves the seller nothing and is still legal', () => {
		const result = announceV4VSplit([row('1', 'alice@example.com', ALLOCATION_TOTAL_BPS)])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.announcement.sellerBps).toBe(0)
	})

	test('an announced zero row is kept, not dropped', () => {
		const result = announceV4VSplit([row('1', 'alice@example.com', 0), row('2', 'bob@example.com', 100)])
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.announcement.rows).toHaveLength(2)
	})

	test('the announcement copies the rows, so later mutation cannot invalidate the commitment', () => {
		const rows = [row('1', 'alice@example.com', 500)]
		const result = announceV4VSplit(rows)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		rows[0] = row('1', 'mallory@example.com', 9999)
		expect(splitMatchesCommitment(result.announcement.rows, result.announcement.commitment)).toBe(true)
	})
})

describe('announceV4VSplit — refusals name the row and the reason', () => {
	test('over-allocation is refused with both numbers', () => {
		const result = announceV4VSplit([row('1', 'alice@example.com', 6000), row('2', 'bob@example.com', 6000)])
		expect(result).toMatchObject({ ok: false, code: 'split_over_allocated' })
		if (result.ok) return
		expect(result.detail).toContain('12000')
		expect(result.detail).toContain(String(ALLOCATION_TOTAL_BPS))
	})

	test('a duplicated destination is refused rather than merged', () => {
		const result = announceV4VSplit([row('1', 'Alice@example.com', 500), row('2', 'alice@EXAMPLE.com', 500)])
		expect(result).toMatchObject({ ok: false, code: 'destination_duplicate' })
	})

	test('a malformed destination is refused and the row is identified', () => {
		const result = announceV4VSplit([row('1', 'alice@example.com', 500), row('2', 'not a destination', 100)])
		expect(result).toMatchObject({ ok: false, code: 'destination_unsupported_scheme', rowId: '2' })
	})

	test('a non-integer or negative share is refused', () => {
		expect(announceV4VSplit([row('1', 'alice@example.com', 10.5)])).toMatchObject({
			ok: false,
			code: 'bps_not_a_positive_integer',
			rowId: '1',
		})
		expect(announceV4VSplit([row('1', 'alice@example.com', -1)])).toMatchObject({
			ok: false,
			code: 'bps_not_a_positive_integer',
			rowId: '1',
		})
	})

	test('a row without an id is refused: the payout ledger must be able to refer to it', () => {
		expect(announceV4VSplit([row('', 'alice@example.com', 100)])).toMatchObject({ ok: false, code: 'row_id_missing' })
	})

	test('too many rows is refused', () => {
		const many = Array.from({ length: SPLIT_MAX_ROWS + 1 }, (_, index) => row(String(index), `user${index}@example.com`, 0))
		expect(announceV4VSplit(many)).toMatchObject({ ok: false, code: 'row_count_exceeded' })
	})

	test('a refused split produces no commitment at all', () => {
		const result = announceV4VSplit([row('1', 'not a destination', 500)])
		expect(result).not.toHaveProperty('announcement')
	})
})

describe('splitMatchesCommitment — what turns a commitment into evidence', () => {
	const rows = [row('1', 'alice@example.com', 500)]

	test('accepts the commitment of the same split, whatever its case', () => {
		const commitment = splitCommitment(rows)
		expect(splitMatchesCommitment(rows, commitment)).toBe(true)
		expect(splitMatchesCommitment(rows, commitment.toUpperCase())).toBe(true)
	})

	test('rejects a split that differs in any committed field', () => {
		const commitment = splitCommitment(rows)
		expect(splitMatchesCommitment([row('1', 'alice@example.com', 501)], commitment)).toBe(false)
		expect(splitMatchesCommitment([row('1', 'bob@example.com', 500)], commitment)).toBe(false)
		expect(splitMatchesCommitment([], commitment)).toBe(false)
	})

	test('rejects a malformed commitment rather than compares loosely', () => {
		expect(splitMatchesCommitment(rows, '')).toBe(false)
		expect(splitMatchesCommitment(rows, 'deadbeef')).toBe(false)
		// @ts-expect-error — a non-string must not crash a validator
		expect(splitMatchesCommitment(rows, null)).toBe(false)
	})
})
