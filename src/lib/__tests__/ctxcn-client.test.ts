/**
 * PlebianCurrencyClient — comprehensive unit coverage (Issue #901).
 *
 * The migration to applesauce-relay added: a 3-relay config, RelayLiveness
 * health tracking, multi-relay failover, an all-relays-down short-circuit, and
 * a subscription/publish lifecycle. The sibling `contextvm-client.test.ts`
 * covers the raw NIP-44 / event-shape crypto; THIS file drives the
 * PlebianCurrencyClient class itself.
 *
 * `applesauce-relay` is replaced with in-process fakes (RelayPool / RelayLiveness)
 * so we can deterministically simulate relay outages, publish results, and
 * inbound gift-wrap responses without touching the network. The real
 * RelayLiveness state machine is exercised in contextvm-client.integration.test.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mock } from 'bun:test'
import { getPublicKey, nip44 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'

/* ------------------------------------------------------------------ *
 * Fakes for applesauce-relay
 * ------------------------------------------------------------------ */

type PublishResponse = { ok: boolean; message?: string; from: string }

type SubCall = {
	relays: string[]
	filters: unknown
	options: unknown
	next: ((event: NostrEvent) => void) | null
	error: ((error: unknown) => void) | null
	unsubscribed: boolean
}

/** In-process liveness double. Faithful to the slice of the real API the
 *  client actually calls: filter(), connectToPool(), disconnectFromPool(). */
class FakeRelayLiveness {
	static instances: FakeRelayLiveness[] = []
	readonly seen = new Set<string>()
	private readonly dead = new Set<string>()
	private readonly down = new Set<string>()
	connectedPools: unknown[] = []
	maxFailuresBeforeDead: number
	constructor(opts?: { maxFailuresBeforeDead?: number }) {
		this.maxFailuresBeforeDead = opts?.maxFailuresBeforeDead ?? 3
		FakeRelayLiveness.instances.push(this)
	}
	connectToPool(pool: unknown) {
		this.connectedPools.push(pool)
	}
	disconnectFromPool(_pool: unknown) {
		this.connectedPools = []
	}
	filter(relays: string[]) {
		return relays.filter((r) => !this.dead.has(r) && !this.down.has(r))
	}
	// ----- test manipulation helpers -----
	markUnhealthy(relay: string) {
		this.down.add(relay)
	}
	markDead(relay: string) {
		this.dead.add(relay)
		this.down.add(relay)
	}
	markHealthy(relay: string) {
		this.dead.delete(relay)
		this.down.delete(relay)
	}
}

/** In-process pool double. Captures subscription/publish calls and lets tests
 *  push synthetic gift-wrap events back through the active subscription. */
class FakeRelayPool {
	static instances: FakeRelayPool[] = []
	subscriptions: SubCall[] = []
	publishes: { relays: string[]; event: NostrEvent; opts: unknown }[] = []
	closed = false
	/** Override hook: if set, publish() delegates here (can throw / reject /
	 *  return partial results). Defaults to "every relay accepts the event". */
	publishFn: ((relays: string[], event: NostrEvent) => Promise<PublishResponse[]>) | null = null
	constructor() {
		FakeRelayPool.instances.push(this)
	}
	subscription(relays: string[], filters: unknown, options?: unknown) {
		const call: SubCall = { relays, filters, options, next: null, error: null, unsubscribed: false }
		this.subscriptions.push(call)
		return {
			subscribe(handlers: { next?: (event: NostrEvent) => void; error?: (error: unknown) => void; complete?: () => void }) {
				call.next = handlers.next ?? null
				call.error = handlers.error ?? null
				return { unsubscribe: () => (call.unsubscribed = true) }
			},
		}
	}
	async publish(relays: string[], event: NostrEvent, opts?: unknown) {
		this.publishes.push({ relays, event, opts })
		if (this.publishFn) return this.publishFn(relays, event)
		return relays.map((from) => ({ from, ok: true }))
	}
	close() {
		this.closed = true
	}
}

// Register the fakes BEFORE importing the client, so the client's
// `import { RelayLiveness, RelayPool } from 'applesauce-relay'` resolves to them.
mock.module('applesauce-relay', () => ({
	RelayPool: FakeRelayPool,
	RelayLiveness: FakeRelayLiveness,
}))

import { PlebianCurrencyClient } from '../ctxcn-client'
import { getCurrencyServerRelays } from '@/lib/constants'

/* ------------------------------------------------------------------ *
 * Shared fixtures & helpers
 * ------------------------------------------------------------------ */

// The client logs liberally; silence it so test output stays readable.
console.warn = () => {}
console.error = () => {}
console.info = () => {}

const SERVER_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
const RELAY_A = 'wss://relay.contextvm.org'
const RELAY_B = 'wss://relay.primal.net'
const RELAY_C = 'wss://relay.nostr.net'
const CVM_RELAYS = [RELAY_A, RELAY_B, RELAY_C]

function newClient(relays: string[] = CVM_RELAYS) {
	FakeRelayPool.instances = []
	FakeRelayLiveness.instances = []
	const privateKey = crypto.getRandomValues(new Uint8Array(32))
	const client = new PlebianCurrencyClient({ privateKey, relays, serverPubkey: SERVER_PUBKEY })
	return {
		client,
		privateKey,
		publicKey: getPublicKey(privateKey),
		pool: FakeRelayPool.instances[0]!,
		liveness: FakeRelayLiveness.instances[0]!,
	}
}

/** Poll until the client has published a request (it waits 1500ms internally). */
async function waitForPublish(pool: FakeRelayPool, timeoutMs = 4000) {
	const start = Date.now()
	while (pool.publishes.length === 0 && Date.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 10))
	}
	if (pool.publishes.length === 0) throw new Error('client never published within ' + timeoutMs + 'ms')
}

/** Build a gift-wrapped (kind 1059) response event the client can decrypt. */
function buildGiftWrapResponse(opts: { recipientPublicKey: string; innerContent: unknown }): NostrEvent {
	const ephemeralPriv = crypto.getRandomValues(new Uint8Array(32))
	const conversationKey = nip44.v2.utils.getConversationKey(ephemeralPriv, opts.recipientPublicKey)
	const encrypted = nip44.v2.encrypt(JSON.stringify(opts.innerContent), conversationKey)
	return {
		kind: 1059,
		pubkey: getPublicKey(ephemeralPriv),
		content: encrypted,
		tags: [['p', opts.recipientPublicKey]],
		created_at: Math.floor(Date.now() / 1000),
		id: 'ab'.repeat(32),
		sig: 'cd'.repeat(64),
	} as unknown as NostrEvent
}

/** Pin crypto.randomUUID so the requestId the client generates is known, letting
 *  us craft a correlating response without having to decrypt the outgoing gift
 *  wrap (which is encrypted to the *server*, not to the client). */
async function withKnownRequestId<T>(id: string, fn: () => Promise<T>): Promise<T> {
	const cryptoObj = globalThis.crypto as Crypto & { randomUUID: () => string }
	const original = cryptoObj.randomUUID
	cryptoObj.randomUUID = () => id
	try {
		return await fn()
	} finally {
		cryptoObj.randomUUID = original
	}
}

/** Temporarily capture setTimeout calls and suppress the real 20s timer so a
 *  test can fire the timeout callback manually without actually waiting. */
async function withCapturedTimeouts<T>(run: (calls: { fn: Function; ms: number | undefined }[]) => Promise<T>): Promise<T> {
	const calls: { fn: Function; ms: number | undefined }[] = []
	const original = globalThis.setTimeout
	globalThis.setTimeout = function (fn: Function, ms?: number) {
		calls.push({ fn, ms })
		if (ms === 20000) return 0 as unknown as ReturnType<typeof setTimeout> // never really wait 20s
		return original(fn as TimerHandler, ms)
	} as unknown as typeof setTimeout
	try {
		return await run(calls)
	} finally {
		globalThis.setTimeout = original
	}
}

/* ------------------------------------------------------------------ *
 * Global guard: no test may leak an unhandled rejection (a real crash
 * signal for the "publish does not crash client" cases).
 * ------------------------------------------------------------------ */
let unhandled: unknown[] = []
const collectUnhandled = (reason: unknown) => unhandled.push(reason)

beforeEach(() => {
	unhandled = []
	process.on('unhandledRejection', collectUnhandled)
})
afterEach(() => {
	process.off('unhandledRejection', collectUnhandled)
	expect(unhandled).toEqual([])
})

/* ------------------------------------------------------------------ *
 * 1. Relay config (Issue #901)
 * ------------------------------------------------------------------ */
describe('relay config — three CVM relays (Issue #901)', () => {
	const originalEnv = process.env.NODE_ENV
	afterEach(() => {
		if (originalEnv === undefined) delete process.env.NODE_ENV
		else process.env.NODE_ENV = originalEnv
	})

	test('production exposes exactly the three CVM relays', () => {
		process.env.NODE_ENV = 'production'
		const relays = getCurrencyServerRelays()
		expect(relays).toHaveLength(3)
		expect(relays).toEqual(CVM_RELAYS)
		expect(relays).toEqual(expect.arrayContaining(CVM_RELAYS))
	})

	test('staging exposes exactly the three CVM relays', () => {
		process.env.NODE_ENV = 'staging'
		const relays = getCurrencyServerRelays()
		expect(relays).toHaveLength(3)
		expect(relays).toEqual(CVM_RELAYS)
	})

	test('development prepends the local relay ahead of the three CVM relays', () => {
		process.env.NODE_ENV = 'development'
		const relays = getCurrencyServerRelays()
		expect(relays).toHaveLength(4)
		expect(relays[0]).toBe('ws://localhost:10547')
		expect(relays.slice(1)).toEqual(CVM_RELAYS)
	})

	test('returns a fresh array on every call (no shared mutable state)', () => {
		process.env.NODE_ENV = 'production'
		const a = getCurrencyServerRelays()
		const b = getCurrencyServerRelays()
		expect(a).not.toBe(b)
		expect(a).toEqual(b)
	})
})

/* ------------------------------------------------------------------ *
 * 2. Health surface wired through the client (RelayLiveness integration
 *    is covered against the real class in contextvm-client.integration.test.ts)
 * ------------------------------------------------------------------ */
describe('client health surface', () => {
	test('every relay is usable on a cold start', () => {
		const { client } = newClient()
		expect(client.healthyRelays()).toEqual(CVM_RELAYS)
		expect(client.allRelaysUnhealthy()).toBe(false)
	})

	test('healthyRelays drops relays liveness marks unhealthy', () => {
		const { client, liveness } = newClient()
		liveness.markUnhealthy(RELAY_A)
		expect(client.healthyRelays()).toEqual([RELAY_B, RELAY_C])
		expect(client.allRelaysUnhealthy()).toBe(false)
	})

	test('allRelaysUnhealthy is true only when no relay survives filtering', () => {
		const { client, liveness } = newClient()
		liveness.markUnhealthy(RELAY_A)
		expect(client.allRelaysUnhealthy()).toBe(false)
		liveness.markUnhealthy(RELAY_B)
		expect(client.allRelaysUnhealthy()).toBe(false)
		liveness.markUnhealthy(RELAY_C)
		expect(client.allRelaysUnhealthy()).toBe(true)
		expect(client.healthyRelays()).toEqual([])
	})

	test('allRelaysUnhealthy is true when no relays are configured at all', () => {
		const { client } = newClient([])
		expect(client.allRelaysUnhealthy()).toBe(true)
	})
})

/* ------------------------------------------------------------------ *
 * 3. Multi-relay failover
 * ------------------------------------------------------------------ */
describe('multi-relay failover', () => {
	test('publish targets only the healthy relays when one is down', async () => {
		const { client, pool, liveness } = newClient()
		liveness.markUnhealthy(RELAY_A)

		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		await waitForPublish(pool)

		expect(pool.publishes).toHaveLength(1)
		expect(pool.publishes[0].relays).toEqual([RELAY_B, RELAY_C])
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})

	test('publish falls back to the single surviving relay when two are down', async () => {
		const { client, pool, liveness } = newClient()
		liveness.markUnhealthy(RELAY_A)
		liveness.markUnhealthy(RELAY_B)

		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		await waitForPublish(pool)

		expect(pool.publishes[0].relays).toEqual([RELAY_C])
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})

	test('publish is never called with a dead relay', async () => {
		const { client, pool, liveness } = newClient()
		liveness.markDead(RELAY_A)

		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		await waitForPublish(pool)

		expect(pool.publishes[0].relays).not.toContain(RELAY_A)
		expect(pool.publishes[0].relays).toEqual([RELAY_B, RELAY_C])
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})

	test('a partially-accepted publish is tolerated (at least one relay ok)', async () => {
		const { client, pool } = newClient()
		pool.publishFn = async (relays) => relays.map((from, i) => ({ from, ok: i !== 0 }))

		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		await waitForPublish(pool)

		// publish resolved (no throw); the request simply waits for a response.
		expect(pool.publishes).toHaveLength(1)
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})
})

/* ------------------------------------------------------------------ *
 * 4. All-relays-down fallback
 * ------------------------------------------------------------------ */
describe('all-relays-down fallback', () => {
	test('publish is skipped entirely when no relay is healthy (graceful, no hang)', async () => {
		const { client, pool, liveness } = newClient()
		for (const r of CVM_RELAYS) liveness.markDead(r)

		expect(client.allRelaysUnhealthy()).toBe(true)

		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		// The client waits 1500ms before publishing; give it room, then assert
		// it never attempted a publish to a dead relay set.
		await new Promise((r) => setTimeout(r, 1900))
		expect(pool.publishes).toHaveLength(0)

		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})

	test('a publish that fails on every relay does not hang the client', async () => {
		const { client, pool } = newClient()
		pool.publishFn = async () => {
			throw new Error('all relays rejected the event')
		}

		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		await waitForPublish(pool)
		expect(pool.publishes).toHaveLength(1)

		// Client stays responsive; the request is cleaned up by close().
		expect(client.healthyRelays()).toEqual(CVM_RELAYS)
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})
})

/* ------------------------------------------------------------------ *
 * 5. Publish/subscribe lifecycle
 * ------------------------------------------------------------------ */
describe('publish/subscribe lifecycle', () => {
	test('a subscription is created on the first callTool', async () => {
		const { client, pool } = newClient()
		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		expect(pool.subscriptions).toHaveLength(1)
		expect(pool.subscriptions[0].filters).toMatchObject({ kinds: [1059] })
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})

	test('the subscription is reused, not duplicated, on subsequent calls', async () => {
		const { client, pool } = newClient()
		// Attach a synchronous catch up front so close()'s rejection is never
		// seen as unhandled while we still need to assert on each promise.
		const pendings = [0, 1, 2].map(() => {
			const p = client.callTool({ name: 'get_btc_price', arguments: {} })
			p.catch(() => {})
			return p
		})
		expect(pool.subscriptions).toHaveLength(1)
		client.close()
		await Promise.all(pendings.map((p) => expect(p).rejects.toThrow('Client closed')))
	})

	test('close() unsubscribes, closes the pool, and rejects pending requests', async () => {
		const { client, pool } = newClient()
		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })

		client.close()

		expect(pool.subscriptions[0].unsubscribed).toBe(true)
		expect(pool.closed).toBe(true)
		await expect(pending).rejects.toThrow('Client closed')
	})

	test('close() disconnects liveness from the pool', () => {
		const { client, liveness } = newClient()
		expect(liveness.connectedPools).toHaveLength(1)
		client.close()
		expect(liveness.connectedPools).toHaveLength(0)
	})

	test('gift-wrap round-trip: a published request and its correlating response resolve the call', async () => {
		const REQUEST_ID = '11111111-2222-3333-4444-555555555555'
		const { client, pool, publicKey } = newClient()

		await withKnownRequestId(REQUEST_ID, async () => {
			const callPromise = client.callTool({ name: 'get_btc_price', arguments: {} })
			await waitForPublish(pool)

			// The request was gift-wrapped (kind 1059) and addressed to the server.
			expect(pool.publishes).toHaveLength(1)
			expect(pool.publishes[0].event.kind).toBe(1059)
			expect(pool.publishes[0].event.tags).toEqual([['p', SERVER_PUBKEY]])

			// Server responds with a gift wrap the client can decrypt, carrying the
			// same JSON-RPC id so the client can correlate it to the pending call.
			const responseInner = {
				kind: 25910,
				pubkey: SERVER_PUBKEY,
				tags: [['p', publicKey]],
				content: JSON.stringify({
					jsonrpc: '2.0',
					id: REQUEST_ID,
					result: { structuredContent: { rates: { USD: 100000 } } },
				}),
				created_at: Math.floor(Date.now() / 1000),
			}
			pool.subscriptions[0].next!(buildGiftWrapResponse({ recipientPublicKey: publicKey, innerContent: responseInner }))

			const result = await callPromise
			expect(result).toEqual({ rates: { USD: 100000 } })
		})
	})
})

/* ------------------------------------------------------------------ *
 * 6. Error handling
 * ------------------------------------------------------------------ */
describe('error handling', () => {
	test('request rejects with "Request timed out" when no response arrives within 20s', async () => {
		await withCapturedTimeouts(async (calls) => {
			const { client } = newClient()
			const pending = client.callTool({ name: 'get_btc_price', arguments: {} })

			const timeoutCall = calls.find((c) => c.ms === 20000)
			expect(timeoutCall).toBeDefined()
			// Simulate the 20s elapsing immediately.
			timeoutCall!.fn()

			await expect(pending).rejects.toThrow('Request timed out')
			client.close()
		})
	})

	test('a malformed gift-wrap response is ignored without rejecting the request', async () => {
		const { client, pool } = newClient()
		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })

		// Garbage content: nip44.decrypt throws inside handleGiftWrapResponse,
		// which must swallow it and leave the request pending.
		const garbage = {
			kind: 1059,
			pubkey: '00'.repeat(32),
			content: 'not-a-valid-nip44-payload',
			tags: [],
			created_at: 1,
			id: 'aa'.repeat(32),
			sig: 'bb'.repeat(64),
		} as unknown as NostrEvent
		pool.subscriptions[0].next!(garbage)

		// Still pending -> close() is what finally settles it (with 'Client closed',
		// NOT with the decrypt error).
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})

	test('an MCP error response (isError flag) rejects the pending request', async () => {
		const REQUEST_ID = '22222222-3333-4444-5555-666666666666'
		const { client, pool, publicKey } = newClient()

		await withKnownRequestId(REQUEST_ID, async () => {
			const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
			await waitForPublish(pool)

			const errorInner = {
				kind: 25910,
				pubkey: SERVER_PUBKEY,
				tags: [['p', publicKey]],
				content: JSON.stringify({
					jsonrpc: '2.0',
					id: REQUEST_ID,
					isError: true,
					result: { structuredContent: { error: 'upstream rate source unavailable' } },
				}),
				created_at: Math.floor(Date.now() / 1000),
			}
			pool.subscriptions[0].next!(buildGiftWrapResponse({ recipientPublicKey: publicKey, innerContent: errorInner }))

			await expect(pending).rejects.toThrow('upstream rate source unavailable')
		})
	})

	test('a network error during publish does not crash the client', async () => {
		const { client, pool } = newClient()
		pool.publishFn = async () => {
			throw new Error('ECONNREFUSED')
		}

		const pending = client.callTool({ name: 'get_btc_price', arguments: {} })
		await waitForPublish(pool)

		// Publish was attempted and failed; the client object is intact and
		// cleanup still works. (No unhandled rejection — afterEach asserts that.)
		expect(pool.publishes).toHaveLength(1)
		expect(() => client.healthyRelays()).not.toThrow()
		client.close()
		await expect(pending).rejects.toThrow('Client closed')
	})
})
