/**
 * Unit tests for the browser cache module.
 *
 * Uses bun's built-in test runner (the project's standard test runner).
 * The WorkerRelayInterface is mocked since it requires a real browser
 * environment with Web Worker support.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test'

// Create mock relay instance
function createMockRelay() {
	return {
		init: mock(() => Promise.resolve()),
		query: mock(() => Promise.resolve([])),
		event: mock(() => Promise.resolve({ ok: true })),
		summary: mock(() => Promise.resolve({ total_events: 0, kinds: {} })),
	} as any
}

// Import the factory functions directly (they don't need the worker import
// since they just wrap a relay instance passed in)
import { createCacheRequest, createPersistFn, isBrowserCacheAvailable } from '../browser-cache'

describe('browser-cache factory functions', () => {
	let mockRelay: any

	beforeEach(() => {
		mockRelay = createMockRelay()
	})

	describe('createCacheRequest', () => {
		it('returns a function', () => {
			const cacheRequest = createCacheRequest(mockRelay)
			expect(typeof cacheRequest).toBe('function')
		})

		it('returns a function that returns a Promise', () => {
			const cacheRequest = createCacheRequest(mockRelay)
			const result = cacheRequest([{ kinds: [1] }])
			expect(result instanceof Promise).toBe(true)
		})

		it('calls relay.query with REQ message format', async () => {
			const cacheRequest = createCacheRequest(mockRelay)
			const filters = [{ kinds: [30402] }, { kinds: [0] }]

			await cacheRequest(filters)

			expect(mockRelay.query).toHaveBeenCalled()
			const callArg = mockRelay.query.mock.calls[0][0]
			expect(callArg[0]).toBe('REQ')
			expect(callArg[1]).toContain('cache-')
			expect(callArg[2]).toEqual(filters[0])
			expect(callArg[3]).toEqual(filters[1])
		})

		it('generates unique subscription IDs', async () => {
			const cacheRequest = createCacheRequest(mockRelay)

			await cacheRequest([{ kinds: [1] }])
			await cacheRequest([{ kinds: [1] }])

			const firstSubId = mockRelay.query.mock.calls[0][0][1]
			const secondSubId = mockRelay.query.mock.calls[1][0][1]

			expect(firstSubId).not.toBe(secondSubId)
			expect(firstSubId).toContain('cache-')
			expect(secondSubId).toContain('cache-')
		})
	})

	describe('createPersistFn', () => {
		it('returns a function', () => {
			const persistFn = createPersistFn(mockRelay)
			expect(typeof persistFn).toBe('function')
		})

		it('calls relay.event for each event', async () => {
			const persistFn = createPersistFn(mockRelay)
			const events = [
				{ id: 'event1', kind: 1, content: 'hello' },
				{ id: 'event2', kind: 1, content: 'world' },
			]

			await persistFn(events as any)

			expect(mockRelay.event).toHaveBeenCalledTimes(2)
			expect(mockRelay.event.mock.calls[0][0]).toEqual(events[0])
			expect(mockRelay.event.mock.calls[1][0]).toEqual(events[1])
		})

		it('handles empty event arrays', async () => {
			const persistFn = createPersistFn(mockRelay)
			await persistFn([])
			expect(mockRelay.event).not.toHaveBeenCalled()
		})

		it('continues on individual event failures (allSettled)', async () => {
			// Simulate: first event succeeds, second fails, third succeeds
			let callCount = 0
			mockRelay.event = mock(() => {
				callCount++
				if (callCount === 2) {
					return Promise.reject(new Error('write failed'))
				}
				return Promise.resolve({ ok: true })
			})

			const persistFn = createPersistFn(mockRelay)
			const events = [{ id: '1' }, { id: '2' }, { id: '3' }]

			// Promise.allSettled catches individual failures — persistFn should resolve
			let threw = false
			try {
				await persistFn(events as any)
			} catch {
				threw = true
			}
			expect(threw).toBe(false)
			expect(mockRelay.event).toHaveBeenCalledTimes(3)
		})
	})

	describe('isBrowserCacheAvailable', () => {
		it('returns false in Node/test environment', () => {
			// In test environment, window is not defined
			expect(isBrowserCacheAvailable()).toBe(false)
		})
	})
})
