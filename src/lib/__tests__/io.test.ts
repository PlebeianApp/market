/**
 * Wave 0 seam tests: verifies the adapter-swap mechanism and pass-through
 * delegation, plus conformance of both real adapters. Relay round-trip
 * behaviour is exercised in Wave A1 against the local nak relay.
 */
import { describe, expect, mock, test } from 'bun:test'

// Stub the NDK singleton so `io-ndk.ts` loads without the full NDK graph.
const stubRawEvent = {
	id: 'evt-1',
	pubkey: 'pk-1',
	created_at: 1,
	kind: 1,
	tags: [],
	content: 'hello',
	sig: 'sig-1',
}
const stubNdkEvent = { rawEvent: () => stubRawEvent }

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		fetchEventsWithTimeout: async () => new Set([stubNdkEvent]),
		publishEvent: async () => new Set(['wss://relay.example']),
		getSigner: () => undefined,
		getUser: async () => null,
	},
	ndkStore: { state: { ndk: null, explicitRelayUrls: [] } },
}))

import { applesauceIo } from '../nostr/io-applesauce'
import { ndkIo } from '../nostr/io-ndk'
import { type NostrIo, fetchEvents, getNostrIo, getUser, publish, setNostrIo, sign, subscribe } from '../nostr/io'

const IO_METHODS = ['fetchEvents', 'subscribe', 'publish', 'sign', 'getUser'] as const

function makeStubIo(overrides: Partial<NostrIo> = {}): NostrIo {
	return {
		fetchEvents: mock(async () => []),
		subscribe: mock(() => () => {}),
		publish: mock(async () => {}),
		sign: mock(async () => ({}) as never),
		getUser: mock(async () => null),
		...overrides,
	}
}

describe('nostr io seam', () => {
	test('both adapters conform to the NostrIo contract', () => {
		for (const adapter of [ndkIo, applesauceIo]) {
			for (const method of IO_METHODS) {
				expect(typeof adapter[method]).toBe('function')
			}
		}
	})

	test('default adapter is the NDK bridge', () => {
		expect(getNostrIo()).toBe(ndkIo)
	})

	test('seam re-exports both adapters for per-module selection without disturbing the global default', async () => {
		// A module that has flipped (e.g. orders relay reads, Wave A1b) imports
		// applesauceIo through the seam and calls it directly, so the global
		// default stays NDK-backed until Wave D. One import swap = one revert.
		const seam = await import('../nostr/io')
		expect(seam.applesauceIo).toBe(applesauceIo)
		expect(seam.ndkIo).toBe(ndkIo)
		expect(getNostrIo()).toBe(ndkIo)
	})

	test('setNostrIo swaps the active adapter', () => {
		const stub = makeStubIo()
		setNostrIo(stub)
		expect(getNostrIo()).toBe(stub)
		// restore default for the rest of the suite
		setNostrIo(ndkIo)
		expect(getNostrIo()).toBe(ndkIo)
	})

	test('pass-throughs delegate to the active adapter', async () => {
		const stub = makeStubIo({
			fetchEvents: mock(async () => [stubRawEvent]),
			subscribe: mock(() => () => {}),
			publish: mock(async () => {}),
			sign: mock(async () => stubRawEvent as never),
			getUser: mock(async () => ({ pubkey: 'pk-stub' })),
		})
		setNostrIo(stub)

		await expect(fetchEvents({ kinds: [1] })).resolves.toEqual([stubRawEvent])
		expect(stub.fetchEvents).toHaveBeenCalledTimes(1)

		const stop = subscribe({ kinds: [1] }, () => {})
		expect(stub.subscribe).toHaveBeenCalledTimes(1)
		stop()

		await publish(stubRawEvent as never)
		expect(stub.publish).toHaveBeenCalledTimes(1)

		await expect(sign({ kind: 1, content: 'c', tags: [], created_at: 1 })).resolves.toBe(stubRawEvent)
		expect(stub.sign).toHaveBeenCalledTimes(1)

		await expect(getUser()).resolves.toEqual({ pubkey: 'pk-stub' })
		expect(stub.getUser).toHaveBeenCalledTimes(1)

		setNostrIo(ndkIo)
	})

	test('NDK bridge maps fetchEvents results to raw events', async () => {
		const events = await ndkIo.fetchEvents({ kinds: [1] })
		expect(events).toEqual([stubRawEvent])
	})
})
