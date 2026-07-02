import { mock, describe, test, expect, afterEach } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'

/**
 * Client-level relay failover coverage (Issue #901, PR #1072).
 *
 * Sibling files cover the RelayLiveness library directly with mock relays
 * (no network) — they prove the filtering mechanics:
 *   - contextvm-client.integration.test.ts: auto-blacklist after 3 failures
 *   - contextvm-relay-liveness.test.ts:     recovery, all-dead, client contract
 *
 * This file closes the last gap in the acceptance criteria: that
 * {@link PlebianCurrencyClient}'s PUBLISH path only ever hands
 * `healthyRelays()` to the pool, so a dead primary relay is never asked to
 * accept the EVENT and therefore cannot block the request. We mock the
 * `applesauce-relay` module (RelayPool + RelayLiveness) with in-process fakes
 * that mirror the real `connectToPool` wiring (add$ / open$ / close$), so no
 * real WebSocket is ever opened.
 */

const RELAYS = ['wss://relay-a.test', 'wss://relay-b.test', 'wss://relay-c.test']

// --- Minimal rxjs-like Subject (what RelayLiveness.connectToPool consumes) --
class FakeSubject<T> {
	private subs = new Set<(v: T) => void>()
	subscribe(fn: (v: T) => void) {
		this.subs.add(fn)
		return { unsubscribe: () => this.subs.delete(fn) }
	}
	next(v: T) {
		for (const s of [...this.subs]) s(v)
	}
}

type CloseEvent = { wasClean: boolean }

class FakeRelay {
	url: string
	open$ = new FakeSubject<void>()
	close$ = new FakeSubject<CloseEvent>()
	constructor(url: string) {
		this.url = url
	}
}

// --- Fakes for the two applesauce-relay exports the client constructs --------
const POOLS: FakeRelayPool[] = []

class FakeRelayPool {
	add$ = new FakeSubject<FakeRelay>()
	remove$ = new FakeSubject<FakeRelay>()
	// publish() is the boundary we assert on: it must only ever receive the
	// healthy relay subset. Each call records {from, ok} like the real pool.
	publish = mock((_relays: string[], _event: unknown) => Promise.resolve(_relays.map((url) => ({ from: url, ok: true }))))
	private relays = new Map<string, FakeRelay>()

	constructor() {
		POOLS.push(this)
	}

	/** Register a relay so connectToPool observes it (mirrors lazy pool.add). */
	register(url: string): FakeRelay {
		let r = this.relays.get(url)
		if (!r) {
			r = new FakeRelay(url)
			this.relays.set(url, r)
			this.add$.next(r)
		}
		return r
	}

	/** Simulate the pool detecting a relay socket dropped uncleanly. */
	dropRelay(url: string, wasClean = false) {
		this.relays.get(url)?.close$.next({ wasClean })
	}

	// Methods the client calls on the pool.
	subscription(_relays: string[], _filter: unknown, _opts?: unknown) {
		return { subscribe: () => ({ unsubscribe() {} }) }
	}
	close() {}
}

const LIVENESS: FakeRelayLiveness[] = []

class FakeRelayLiveness {
	private maxFailuresBeforeDead: number
	private failures = new Map<string, number>()
	private dead = new Set<string>()

	constructor(options?: { maxFailuresBeforeDead?: number }) {
		this.maxFailuresBeforeDead = options?.maxFailuresBeforeDead ?? 5
		LIVENESS.push(this)
	}

	// Mirrors the real connectToPool: relays surface via add$, and an unclean
	// close counts as a failure; once failures cross the threshold the relay is
	// dead and filter() excludes it.
	connectToPool(pool: FakeRelayPool) {
		pool.add$.subscribe((relay) => {
			relay.open$.subscribe(() => this.failures.set(relay.url, 0))
			relay.close$.subscribe((event) => {
				if (event.wasClean) return
				const count = (this.failures.get(relay.url) ?? 0) + 1
				this.failures.set(relay.url, count)
				if (count >= this.maxFailuresBeforeDead) this.dead.add(relay.url)
			})
		})
	}

	disconnectFromPool(_pool: FakeRelayPool) {}

	filter(relays: string[]) {
		return relays.filter((r) => !this.dead.has(r))
	}
}

// Register the module mock BEFORE the client is imported. The factory only runs
// when something first imports 'applesauce-relay' (our dynamic import below), by
// which point every class above is initialised.
mock.module('applesauce-relay', () => ({
	RelayPool: FakeRelayPool,
	RelayLiveness: FakeRelayLiveness,
}))

const { PlebianCurrencyClient } = await import('../ctxcn-client')

const SERVER_PUBKEY = getPublicKey(crypto.getRandomValues(new Uint8Array(32)))

function newClient(relays = RELAYS) {
	return new PlebianCurrencyClient({
		privateKey: crypto.getRandomValues(new Uint8Array(32)),
		relays,
		serverPubkey: SERVER_PUBKEY,
	})
}

describe('PlebianCurrencyClient relay failover (mocked pool)', () => {
	afterEach(() => {
		POOLS.length = 0
		LIVENESS.length = 0
	})

	test('publish targets only healthy relays — a dead primary is never handed to the pool', async () => {
		const client = newClient()
		const pool = POOLS[0]!

		// Cold start: every relay usable, nothing published yet.
		expect(client.healthyRelays()).toEqual(RELAYS)

		// Wire the relays into the pool so liveness can observe them (the real
		// pool does this lazily as relays connect).
		for (const url of RELAYS) pool.register(url)

		// Drive the PRIMARY relay past the failure threshold (maxFailuresBeforeDead: 3).
		for (let i = 0; i < 3; i++) pool.dropRelay(RELAYS[0])

		// Failover contract: RelayLiveness filtered the dead primary, the other
		// two relays remain healthy, and the caller does not short-circuit yet.
		expect(client.healthyRelays()).toEqual([RELAYS[1], RELAYS[2]])
		expect(client.allRelaysUnhealthy()).toBe(false)

		// Trigger the publish path. It must consult healthyRelays() and publish
		// to exactly the two survivors — the dead primary is absent from the
		// publish call, so it cannot block the request.
		const result = await (client as any).sendEncryptedMessage({
			id: 'req-failover',
			jsonrpc: '2.0',
			method: 'tools/call',
			params: { name: 'get_price', arguments: {} },
		})

		expect(pool.publish).toHaveBeenCalledTimes(1)
		const [publishedRelays] = pool.publish.mock.calls[0]
		expect(publishedRelays).toEqual([RELAYS[1], RELAYS[2]])
		expect(publishedRelays).not.toContain(RELAYS[0])
		expect(result.giftWrapId).toEqual(expect.any(String))

		client.close()
	})

	test('when every relay is dead, publish short-circuits instead of blocking', async () => {
		const client = newClient()
		const pool = POOLS[0]!

		for (const url of RELAYS) pool.register(url)
		// Kill all three relays.
		for (const url of RELAYS) for (let i = 0; i < 3; i++) pool.dropRelay(url)

		expect(client.healthyRelays()).toEqual([])
		expect(client.allRelaysUnhealthy()).toBe(true)

		// No healthy relay -> sendEncryptedMessage returns WITHOUT publishing,
		// so a fully-dead relay set cannot hang the request (caller falls back).
		const result = await (client as any).sendEncryptedMessage({
			id: 'req-all-dead',
			jsonrpc: '2.0',
			method: 'tools/call',
			params: { name: 'get_price', arguments: {} },
		})

		expect(pool.publish).not.toHaveBeenCalled()
		expect(result.giftWrapId).toEqual(expect.any(String))

		client.close()
	})
})
