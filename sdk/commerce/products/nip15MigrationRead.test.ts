import { describe, expect, test } from 'bun:test'
import {
	buildMigratedProductsFilter,
	buildNip15ProductsFilter,
	collectMigratedOriginalIds,
	readRelayListUrls,
	resolveMigrationRelays,
} from './nip15MigrationRead'

describe('nip15MigrationRead', () => {
	test('builds product filters', () => {
		expect(buildNip15ProductsFilter('pk')).toEqual({ kinds: [30018], authors: ['pk'], limit: 100 })
		expect(buildMigratedProductsFilter('pk')).toEqual({ kinds: [30402], authors: ['pk'], limit: 1000 })
	})

	test('reads r-tag urls from the most recent timestamped relay list', () => {
		const events = [
			{ created_at: 1, tags: [['r', 'wss://old']] },
			{
				created_at: 2,
				tags: [
					['r', 'wss://a', 'read'],
					['r', ''],
					['p', 'x'],
					['r', 'wss://b'],
				],
			},
		]
		expect(readRelayListUrls(events)).toEqual(['wss://a', 'wss://b'])
		expect(readRelayListUrls([{ tags: [['r', 'wss://x']] }])).toEqual([])
		expect(readRelayListUrls([])).toEqual([])
	})

	test('orders app relay first and falls back only without user relays', () => {
		expect(resolveMigrationRelays('wss://app', ['wss://u', 'wss://app'], ['wss://f'])).toEqual(['wss://app', 'wss://u'])
		expect(resolveMigrationRelays('wss://app', [], ['wss://f', 'wss://app'])).toEqual(['wss://app', 'wss://f'])
		expect(resolveMigrationRelays(undefined, [], [])).toEqual([])
	})

	test('collects the first migrated tag id per event', () => {
		const ids = collectMigratedOriginalIds([
			{
				tags: [
					['migrated', 'a'],
					['migrated', 'ignored'],
				],
			},
			{ tags: [['migrated', '']] },
			{ tags: [['d', 'x']] },
			{ tags: [['migrated', 'b']] },
		])
		expect([...ids]).toEqual(['a', 'b'])
	})
})
