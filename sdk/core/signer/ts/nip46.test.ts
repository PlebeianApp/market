/**
 * The NIP-46 lane's environmental contract: what it refuses without, and the
 * deadlines it keeps.
 *
 * Harvested cases: the deadline wrapper and the subscription lifecycle are the
 * market's (`nostr-connect-signer.test.ts`, "RPC timeout wrapper" and
 * "session teardown"). The refusals are this module's own — the market's lane
 * had a `defaultPool()` that reached the app's relay adapter, so it never had to
 * refuse; here the transport is injected and its absence is a typed refusal.
 */
import { describe, expect, test } from 'bun:test'

import { Nip46RpcTimeoutError, ClockRequiredError, TransportRequiredError, createSignerSession } from './index'
import type { SessionSnapshot, SessionState } from './index'
import {
	BUNKER_SECRET,
	CLIENT_SK,
	RELAY,
	REMOTE_PK,
	USER_PK,
	bunkerTransport,
	bunkerUrl,
	manualClock,
	makeNbunksec,
	settle,
	userTemplate,
} from './harness'
import { connectBunkerSigner, createNostrConnectClient, rehydrateNostrConnectSession, withRpcTimeout } from './nip46'

describe('the injected environment', () => {
	test('a NIP-46 lane without an injected transport refuses instead of reaching for a host default', async () => {
		const clock = manualClock()

		expect(() => createNostrConnectClient({ relays: [RELAY], clientKeyHex: CLIENT_SK })).toThrow(TransportRequiredError)
		await expect(connectBunkerSigner(bunkerUrl(), { clock })).rejects.toThrow(/injected transport/i)
		await expect(rehydrateNostrConnectSession(makeNbunksec(), { clock })).rejects.toThrow(/injected transport/i)
	})

	test('a NIP-46 lane without an injected clock refuses instead of reaching for a global timer', async () => {
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })

		await expect(connectBunkerSigner(bunkerUrl(), { transport: transport.pool })).rejects.toThrow(ClockRequiredError)
		await expect(rehydrateNostrConnectSession(makeNbunksec(), { transport: transport.pool })).rejects.toThrow(/injected clock/i)
	})

	test('rehydrate resolves the user identity through the real connect RPC, not the client key', async () => {
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })

		const bundle = await rehydrateNostrConnectSession(makeNbunksec(), {
			transport: transport.pool,
			clock: manualClock(),
		})

		expect(bundle.signer.remote).toBe(REMOTE_PK)
		expect(bundle.signer.isConnected).toBe(true)
		expect(await bundle.capability.getPublicKey()).toBe(USER_PK)
		expect(await bundle.capability.getPublicKey()).not.toBe(bundle.signer.clientPubkey)
		await bundle.signer.close()
	})
})

describe('the deadline wrapper', () => {
	test('a silent remote rejects with a lane-specific error instead of hanging forever', async () => {
		const clock = manualClock()
		const raced = withRpcTimeout(clock, 'sign_event', new Promise<never>(() => {}), 10)

		expect(clock.pending()).toBe(1)
		clock.advance()

		await expect(raced).rejects.toThrow(Nip46RpcTimeoutError)
		await expect(raced).rejects.toThrow(/NIP-46 sign_event .* timed out after 10ms/)
	})

	test('resolves the operation result when it settles before the deadline', async () => {
		const clock = manualClock()
		await expect(withRpcTimeout(clock, 'connect', Promise.resolve('ack'), 10_000)).resolves.toBe('ack')
		expect(clock.pending()).toBe(0)
	})

	test('does not swallow an underlying rejection', async () => {
		const clock = manualClock()
		await expect(withRpcTimeout(clock, 'connect', Promise.reject(new Error('bunker refused')), 10_000)).rejects.toThrow('bunker refused')
	})
})

describe('the session over the lanes', () => {
	function observed(session: ReturnType<typeof createSignerSession>) {
		let last: SessionSnapshot | undefined
		const states: SessionState[] = []
		session.observeSession((snapshot) => {
			last = snapshot
			states.push(snapshot.state)
		})
		return {
			states,
			current: () => {
				if (!last) throw new Error('nothing observed')
				return last
			},
		}
	}

	test('an unapproved client-initiated lane ends in a deadline refusal, and the session fails closed', async () => {
		const transport = bunkerTransport()
		const clock = manualClock()
		const session = createSignerSession({
			settings: { rpcTimeout: { connectMs: 60_000 } },
			ports: { transport: transport.pool, clock },
		})
		const view = observed(session)

		const started = session.startSession({
			lane: 'nostrconnect',
			relays: [RELAY],
			clientKeyHex: CLIENT_SK,
			onAuthUrl: async () => {},
		})

		await settle()
		clock.advance()

		await expect(started).rejects.toThrow(Nip46RpcTimeoutError)
		expect(view.current().state).toBe('failed')
		expect(view.current().pubkey).toBeUndefined()
		expect(view.states).toEqual(['idle', 'connecting', 'awaiting_user', 'failed'])
	})

	test('a failed lane releases what it opened — no REQ subscription survives the failure', async () => {
		// B2: the unapproved-QR path above used to leave its relay REQ subscription
		// open forever — the failure path dropped the lane's teardown without
		// running it, and `endSession()` returned from `failed` before teardown too,
		// so nothing in the contract could close it.
		const transport = bunkerTransport()
		const clock = manualClock()
		const session = createSignerSession({
			settings: { rpcTimeout: { connectMs: 60_000 } },
			ports: { transport: transport.pool, clock },
		})

		const started = session.startSession({
			lane: 'nostrconnect',
			relays: [RELAY],
			clientKeyHex: CLIENT_SK,
			onAuthUrl: async () => {},
		})
		await settle()
		expect(transport.active()).toBe(1)

		clock.advance()
		await expect(started).rejects.toThrow(Nip46RpcTimeoutError)

		expect(transport.active()).toBe(0)
		await session.endSession()
		expect(transport.active()).toBe(0)
	})

	test('login-logout-login closes the REQ subscription so it does not stack', async () => {
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const session = createSignerSession({
			ports: { transport: transport.pool, clock: manualClock() },
		})

		// Login 1 — the production seam (the bunker lane), then log out.
		await session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })
		expect(transport.active()).toBe(1)
		await session.endSession()
		expect(transport.active()).toBe(0)

		// Login 2 — a fresh session must not stack on top of a leaked subscription.
		await session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })
		expect(transport.active()).toBe(1)
		await session.endSession()
		expect(transport.active()).toBe(0)
	})

	test('signEvent reuses the resolved identity — one get_public_key RPC in total', async () => {
		const transport = bunkerTransport({ expectSecret: BUNKER_SECRET })
		const session = createSignerSession({
			ports: { transport: transport.pool, clock: manualClock() },
		})

		await session.startSession({ lane: 'bunker', bunkerUrl: bunkerUrl(), clientKeyHex: CLIENT_SK })
		await session.getPublicKey()
		await session.getPublicKey()
		await session.signEvent(userTemplate('a'))
		await session.signEvent(userTemplate('b'))

		// Before the cache, every sign issued a fresh get_public_key RPC just for
		// the identity assertion; now it is issued once and reused.
		expect(transport.log.filter((method) => method === 'get_public_key')).toHaveLength(1)
		expect(transport.log.filter((method) => method === 'sign_event')).toHaveLength(2)
		await session.endSession()
	})
})
