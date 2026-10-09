/**
 * The auction page's validator roster.
 *
 * The invariant worth locking: the roster is derived from the AUCTION's `auditors` tags, and
 * announcements only decorate it. A validator that has announced nothing must still be listed —
 * its verdict still counts towards the quorum, so hiding it would misrepresent who decides the
 * outcome. The tests below also pin the join (case-insensitive), the order (the root's) and the
 * dedupe (the pool is a set).
 */
import { describe, expect, test } from 'bun:test'
import { auditorRoster, type MultipartyAnnouncements } from '@/lib/auction/multipartyAnnouncements'

const ANNOUNCED = 'A'.repeat(64)
const SILENT = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

const announcements = (): MultipartyAnnouncements => ({
	validators: [
		{
			pubkey: ANNOUNCED,
			name: 'North Relay Watch',
			picture: 'https://example.com/north.png',
			feeBps: 200,
			capabilityEventId: '1'.repeat(64),
			offerEventId: '2'.repeat(64),
			capabilityExpiresAt: 1_800_000_000,
			minValidators: 3,
			minQuorumPercent: 67,
		},
	],
	recipients: [],
})

describe('auditorRoster', () => {
	test('follows the auction tag order, not the announcement order', () => {
		const rows = auditorRoster([SILENT, ANNOUNCED], announcements())
		expect(rows.map((row) => row.pubkey)).toEqual([SILENT, ANNOUNCED])
	})

	test('decorates an announced validator with its fee and terms', () => {
		const [row] = auditorRoster([ANNOUNCED], announcements())
		expect(row.announced).toBe(true)
		expect(row.name).toBe('North Relay Watch')
		expect(row.picture).toBe('https://example.com/north.png')
		expect(row.feeLabel).toBe('2.00%')
		expect(row.rulesLabel).toContain('2.00%')
		expect(row.rulesLabel).toContain('3 validators')
		expect(row.rulesLabel).toContain('67%')
	})

	test('joins case-insensitively — a pubkey is not case-sensitive on the wire', () => {
		const rows = auditorRoster([ANNOUNCED.toLowerCase(), SILENT], announcements())
		expect(rows[0].announced).toBe(true)
		expect(rows[0].feeLabel).toBe('2.00%')
	})

	test('a silent validator is still listed, without terms', () => {
		const rows = auditorRoster([SILENT], announcements())
		expect(rows).toHaveLength(1)
		expect(rows[0].announced).toBe(false)
		expect(rows[0].feeLabel).toBeUndefined()
		expect(rows[0].rulesLabel).toBeUndefined()
	})

	test('duplicate auditor tags collapse — the pool is a set', () => {
		const rows = auditorRoster([ANNOUNCED, ANNOUNCED.toLowerCase(), SILENT], announcements())
		expect(rows).toHaveLength(2)
		expect(rows.map((row) => row.pubkey)).toEqual([ANNOUNCED, SILENT])
	})

	test('an unknown validator in the announcement feed does not invent a row', () => {
		const rows = auditorRoster([SILENT], announcements())
		expect(rows.some((row) => row.pubkey === OTHER)).toBe(false)
	})

	test('an auction with no auditors has an empty roster', () => {
		expect(auditorRoster([], announcements())).toEqual([])
	})
})
