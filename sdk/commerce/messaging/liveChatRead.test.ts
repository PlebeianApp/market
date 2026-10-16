import { describe, expect, test } from 'bun:test'
import {
	buildLiveActivityFilter,
	buildLiveChatMessagesFilter,
	getLiveActivityCandidateRejection,
	sortLiveActivityCandidates,
	sortLiveChatMessages,
} from './liveChatRead'

const CVM = 'c'.repeat(64)
const expected = { cvmServerPubkey: CVM, expectedActivityD: 'auction:0123456789ab' }
const candidate = (overrides: Partial<{ id: string; pubkey: string; kind: number; created_at: number; tags: string[][] }> = {}) => ({
	id: 'id',
	pubkey: CVM,
	kind: 30311,
	created_at: 10,
	tags: [['d', expected.expectedActivityD]],
	...overrides,
})

describe('liveChatRead filters', () => {
	test('live activity filter pins author, auction coord and derived d', () => {
		expect(buildLiveActivityFilter('30408:seller:auction-1', expected)).toEqual({
			kinds: [30311],
			authors: [CVM],
			'#a': ['30408:seller:auction-1'],
			'#d': ['auction:0123456789ab'],
			limit: 10,
		})
	})

	test('chat filter', () => {
		expect(buildLiveChatMessagesFilter('30311:x:y')).toEqual({ kinds: [1311], '#a': ['30311:x:y'], limit: 200 })
	})
})

describe('sortLiveActivityCandidates', () => {
	test('newest first, lower id on ties, missing created_at treated as 0', () => {
		const sorted = sortLiveActivityCandidates(
			new Set([
				candidate({ id: 'b', created_at: 5 }),
				candidate({ id: 'a', created_at: 5 }),
				candidate({ id: 'z', created_at: 9 }),
				{ id: 'none', pubkey: CVM, kind: 30311 },
			]),
		)
		expect(sorted.map((e) => e.id)).toEqual(['z', 'a', 'b', 'none'])
	})
})

describe('getLiveActivityCandidateRejection', () => {
	test('accepts a matching candidate', () => {
		expect(getLiveActivityCandidateRejection(candidate(), expected)).toBeNull()
	})

	test('rejects in author, kind, d-tag order', () => {
		expect(getLiveActivityCandidateRejection(candidate({ pubkey: 'x', kind: 1 }), expected)).toEqual({ reason: 'author', value: 'x' })
		expect(getLiveActivityCandidateRejection(candidate({ kind: 1 }), expected)).toEqual({ reason: 'kind', value: 1 })
		expect(getLiveActivityCandidateRejection(candidate({ tags: [['d', 'auction-1']] }), expected)).toEqual({
			reason: 'd-tag',
			value: 'auction-1',
		})
		expect(getLiveActivityCandidateRejection({ id: 'x', pubkey: CVM, kind: 30311 }, expected)).toEqual({
			reason: 'd-tag',
			value: undefined,
		})
	})
})

describe('sortLiveChatMessages', () => {
	test('oldest first', () => {
		const sorted = sortLiveChatMessages([{ createdAt: 3 }, { createdAt: 1 }, { createdAt: 2 }])
		expect(sorted.map((m) => m.createdAt)).toEqual([1, 2, 3])
	})
})
