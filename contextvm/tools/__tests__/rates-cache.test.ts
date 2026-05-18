import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { RatesCache } from '../rates-cache'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

let cache: RatesCache
let dbPath: string

describe('RatesCache', () => {
	beforeEach(() => {
		const dir = mkdtempSync('rates-cache-test-')
		dbPath = join(dir, 'test-cache.sqlite')
		cache = new RatesCache(dbPath)
	})

	afterEach(() => {
		cache.close()
		const dir = dbPath.replace('/test-cache.sqlite', '')
		rmSync(dir, { recursive: true, force: true })
	})

	test('returns null for missing key', () => {
		expect(cache.get('nonexistent')).toBeNull()
	})

	test('stores and retrieves a value', () => {
		cache.set('rates', '{"USD": 100000}', 60000)
		const result = cache.get('rates')
		expect(result).toBe('{"USD": 100000}')
	})

	test('returns null for expired entry', () => {
		const originalNow = Date.now
		const baseTime = 1_700_000_000_000

		try {
			Date.now = () => baseTime
			cache.set('rates', '{"USD": 100000}', 100)
			expect(cache.get('rates')).toBe('{"USD": 100000}')

			Date.now = () => baseTime + 101
			expect(cache.get('rates')).toBeNull()
		} finally {
			Date.now = originalNow
		}
	})

	test('overwrites existing key', () => {
		cache.set('rates', '{"USD": 100000}', 60000)
		cache.set('rates', '{"USD": 101000}', 60000)
		expect(cache.get('rates')).toBe('{"USD": 101000}')
	})

	test('handles multiple keys', () => {
		cache.set('key1', 'value1', 60000)
		cache.set('key2', 'value2', 60000)
		expect(cache.get('key1')).toBe('value1')
		expect(cache.get('key2')).toBe('value2')
		expect(cache.get('key3')).toBeNull()
	})

	test('evictExpired removes expired entries', () => {
		cache.set('fresh', 'data', 60000)
		cache.set('expired', 'data', 1)

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				const removed = cache.evictExpired()
				expect(removed).toBeGreaterThanOrEqual(1)
				expect(cache.get('fresh')).toBe('data')
				resolve()
			}, 50)
		})
	})

	test('works with in-memory database', () => {
		const memCache = new RatesCache(':memory:')
		expect(memCache.get('test')).toBeNull()
		memCache.set('test', 'hello', 60000)
		expect(memCache.get('test')).toBe('hello')
		memCache.close()
	})

	test('persists across cache instances', () => {
		cache.set('persist', 'data', 60000)
		cache.close()

		const newCache = new RatesCache(dbPath)
		expect(newCache.get('persist')).toBe('data')
		newCache.close()
	})
})
