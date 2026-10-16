import { describe, expect, test } from 'bun:test'
import {
	buildRelayListFilter,
	buildRelayPreferencesFilter,
	parseRelayListEvents,
	parseRelayPreferencesContent,
	pickMostRecentTimestampedEvent,
} from './relayListRead'

const ALICE = 'b'.repeat(64)

describe('relay filters', () => {
	test('relay list filter is kind 10002, limit 1', () => {
		expect(buildRelayListFilter(ALICE)).toEqual({ kinds: [10002], authors: [ALICE], limit: 1 })
	})

	test('relay preferences filter is kind 30078 with the app d-tag, limit 1', () => {
		expect(buildRelayPreferencesFilter(ALICE)).toEqual({
			kinds: [30078],
			authors: [ALICE],
			'#d': ['plebeian-market-relay-preferences'],
			limit: 1,
		})
	})
})

describe('pickMostRecentTimestampedEvent', () => {
	test('first event with the highest timestamp wins', () => {
		const a = { id: 'a', created_at: 5 }
		const b = { id: 'b', created_at: 10 }
		const c = { id: 'c', created_at: 10 }
		expect(pickMostRecentTimestampedEvent(new Set([a, b, c]))).toBe(b)
	})

	test('events without a positive timestamp never win', () => {
		const untimed: { id: string; created_at?: number }[] = [{ id: 'a' }, { id: 'b', created_at: 0 }]
		expect(pickMostRecentTimestampedEvent(untimed)).toBeUndefined()
		expect(pickMostRecentTimestampedEvent([])).toBeUndefined()
	})
})

describe('parseRelayListEvents', () => {
	test('parses r tags of the newest event with read/write markers', () => {
		const older = { tags: [['r', 'wss://old']], created_at: 1 }
		const newer = {
			tags: [
				['r', 'wss://both'],
				['r', 'wss://read', 'read'],
				['r', 'wss://write', 'write'],
				['r', ''],
				['p', 'x'],
			],
			created_at: 2,
		}
		expect(parseRelayListEvents([older, newer])).toEqual([
			{ url: 'wss://both', read: true, write: true },
			{ url: 'wss://read', read: true, write: false },
			{ url: 'wss://write', read: false, write: true },
		])
	})

	test('no usable event yields an empty list', () => {
		expect(parseRelayListEvents([])).toEqual([])
		expect(parseRelayListEvents([{ tags: [['r', 'wss://x']] }])).toEqual([])
	})
})

describe('parseRelayPreferencesContent', () => {
	test('reads includeAppDefaults and falls back to the default', () => {
		expect(parseRelayPreferencesContent('{"includeAppDefaults":false}')).toEqual({ includeAppDefaults: false })
		expect(parseRelayPreferencesContent('{}')).toEqual({ includeAppDefaults: true })
		expect(parseRelayPreferencesContent('{"includeAppDefaults":null}')).toEqual({ includeAppDefaults: true })
		expect(parseRelayPreferencesContent('5')).toEqual({ includeAppDefaults: true })
	})

	test('throws on invalid JSON and null content', () => {
		expect(() => parseRelayPreferencesContent('')).toThrow()
		expect(() => parseRelayPreferencesContent('{bad')).toThrow()
		expect(() => parseRelayPreferencesContent('null')).toThrow()
	})
})
