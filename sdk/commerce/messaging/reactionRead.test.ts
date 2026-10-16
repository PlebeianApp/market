import { describe, expect, test } from 'bun:test'
import {
	buildReactionDeletionFilter,
	buildReactionFilter,
	collectDeletedEventIds,
	filterForLatestReactionsOnly,
	groupReactionsByContent,
	normalizeReactionEmoji,
	parseReaction,
	removeDeletedReactions,
	sortReactionsIntoGroups,
	sortReactionsNewestFirst,
	type ReactionRecord,
} from './reactionRead'

const PK = 'a'.repeat(64)
const product = { id: 'product-id', pubkey: PK, kind: 30402, content: '', tags: [['d', 'shirt']] }
const note = { id: 'note-id', pubkey: PK, kind: 1, content: '', tags: [] }

const reaction = (id: string, author: string, emoji: string, createdAt: number): ReactionRecord<{ id: string }> => ({
	id,
	emoji,
	createdAt,
	authorPubkey: author,
	targetEvent: { id: 'note-id' },
})

describe('reaction filters', () => {
	test('addressable targets use #a, regular targets use #e', () => {
		expect(buildReactionFilter(product)).toEqual({
			kinds: [7],
			'#k': ['30402'],
			'#p': [PK],
			limit: 100,
			'#a': [`30402:${PK}:shirt`],
		})
		expect(buildReactionFilter(note)).toEqual({ kinds: [7], '#k': ['1'], '#p': [PK], limit: 100, '#e': ['note-id'] })
	})

	test('deletion filter targets reaction ids', () => {
		expect(buildReactionDeletionFilter(['r1', 'r2'])).toEqual({ kinds: [5], '#e': ['r1', 'r2'] })
	})
})

describe('parseReaction', () => {
	test('maps content to emoji and keeps the target', () => {
		const parsed = parseReaction({ id: 'r', pubkey: 'b', kind: 7, content: '+', tags: [], created_at: 9 }, note)
		expect(parsed).toEqual({ id: 'r', emoji: '+', createdAt: 9, authorPubkey: 'b', targetEvent: note })
	})
})

describe('normalizeReactionEmoji', () => {
	test('maps aliases and colon emojis, passes others through', () => {
		expect(normalizeReactionEmoji('+')).toBe('❤️')
		expect(normalizeReactionEmoji('-')).toBe('👎')
		expect(normalizeReactionEmoji('❤')).toBe('❤️')
		expect(normalizeReactionEmoji(':zapstore:')).toBe('❤️')
		expect(normalizeReactionEmoji('🔥')).toBe('🔥')
		expect(normalizeReactionEmoji('')).toBe('')
	})
})

describe('filterForLatestReactionsOnly', () => {
	test('keeps the newest per target+author+emoji; ties keep the first', () => {
		const result = filterForLatestReactionsOnly([
			reaction('old', 'u1', '🔥', 1),
			reaction('new', 'u1', '🔥', 2),
			reaction('tie', 'u1', '🔥', 2),
			reaction('other', 'u1', '👍', 1),
		])
		expect(result.map((r) => r.id)).toEqual(['new', 'other'])
	})
})

describe('grouping', () => {
	test('groups by normalized emoji, dedupes same author only when raw emoji equals normalized', () => {
		const grouped = groupReactionsByContent([
			reaction('a', 'u1', '🔥', 1),
			reaction('b', 'u1', '🔥', 2),
			reaction('c', 'u1', '+', 3),
			reaction('d', 'u1', '+', 4),
			reaction('e', 'u2', ':custom:', 5),
		])
		expect(grouped.get('🔥')!.map((r) => r.id)).toEqual(['a'])
		expect(grouped.get('❤️')!.map((r) => r.id)).toEqual(['c', 'd', 'e'])
	})

	test('sortReactionsIntoGroups orders by group size, largest first', () => {
		const sorted = sortReactionsIntoGroups([reaction('a', 'u1', '🔥', 1), reaction('b', 'u1', '👍', 1), reaction('c', 'u2', '👍', 1)])
		expect(Array.from(sorted.keys())).toEqual(['👍', '🔥'])
	})
})

describe('deletions and ordering', () => {
	test('collects e-tag ids from deletion events and removes them', () => {
		const deleted = collectDeletedEventIds([
			{
				tags: [
					['e', 'r1'],
					['p', 'x'],
					['e', 'r3'],
				],
			},
			{ tags: [] },
		])
		expect(Array.from(deleted)).toEqual(['r1', 'r3'])
		const kept = removeDeletedReactions([reaction('r1', 'u', '🔥', 1), reaction('r2', 'u', '🔥', 1)], deleted)
		expect(kept.map((r) => r.id)).toEqual(['r2'])
	})

	test('sorts newest first in place', () => {
		const list = [reaction('a', 'u', '🔥', 1), reaction('b', 'u', '🔥', 3), reaction('c', 'u', '🔥', 2)]
		expect(sortReactionsNewestFirst(list)).toBe(list)
		expect(list.map((r) => r.id)).toEqual(['b', 'c', 'a'])
	})
})
