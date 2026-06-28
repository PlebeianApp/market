import { describe, test, expect } from 'bun:test'
import { RelayLiveness } from 'applesauce-relay'
import { getPublicKey } from 'nostr-tools/pure'
import { PlebianCurrencyClient } from '../ctxcn-client'

/**
 * Relay failover coverage (Issue #901, PR #1072).
 *
 * The integration file (contextvm-client.integration.test.ts) already proves:
 *   - cold start → every relay usable, allRelaysUnhealthy() false
 *   - one relay blacklisted after maxFailuresBeforeDead while the rest survive
 *
 * This unit file closes the remaining failover gaps that the acceptance
 * criteria depend on:
 *   - recovery: a transient outage must NOT permanently evict a relay
 *   - the all-dead state (the trigger for the Yadio HTTPS fallback)
 *   - the client boundary contract for allRelaysUnhealthy()
 *
 * Runs in the unit suite (no network): RelayLiveness is driven directly via
 * recordFailure/recordSuccess against synthetic relay URLs.
 */

const RELAYS = ['wss://relay-a.test', 'wss://relay-b.test', 'wss://relay-c.test']
const DEAD_AFTER = 3

function freshLiveness() {
	return new RelayLiveness({
		maxFailuresBeforeDead: DEAD_AFTER,
		backoffBaseDelay: 1,
		backoffMaxDelay: 1,
	})
}

/** Push a relay past the failure threshold, clearing each 1ms backoff window. */
async function killRelay(liveness: RelayLiveness, url: string, failures = DEAD_AFTER) {
	for (let i = 0; i < failures; i++) {
		liveness.recordFailure(url)
		await new Promise((r) => setTimeout(r, 10))
	}
}

describe('RelayLiveness failover — recovery', () => {
	test('a dead relay can be recovered (reset clears its liveness state, relay usable again)', async () => {
		const liveness = freshLiveness()
		await killRelay(liveness, RELAYS[0])

		expect(liveness.filter(RELAYS)).not.toContain(RELAYS[0])
		expect(liveness.getState(RELAYS[0])?.state).toBe('dead')

		// Recovery: clearing the dead state (in production this is driven by the
		// pool's reconnect events via connectToPool; reset() is the direct way)
		// brings the relay back into the usable set so a transient outage does
		// not permanently evict a relay.
		liveness.reset(RELAYS[0])
		expect(liveness.filter(RELAYS)).toContain(RELAYS[0])
		expect(liveness.filter(RELAYS).length).toBe(RELAYS.length)
	})

	test('recordSuccess keeps a healthy relay healthy and does not throw (idempotent)', () => {
		const liveness = freshLiveness()
		liveness.recordSuccess(RELAYS[0])
		liveness.recordSuccess(RELAYS[0])
		expect(liveness.filter(RELAYS)).toContain(RELAYS[0])
	})
})

describe('RelayLiveness failover — all-dead fallback trigger', () => {
	test('filter([]) once every relay crosses the failure threshold', async () => {
		const liveness = freshLiveness()
		expect(liveness.filter(RELAYS).length).toBe(RELAYS.length)

		// Kill them one by one and watch the usable set shrink each step.
		await killRelay(liveness, RELAYS[0])
		expect(liveness.filter(RELAYS).length).toBe(2)
		await killRelay(liveness, RELAYS[1])
		expect(liveness.filter(RELAYS).length).toBe(1)
		await killRelay(liveness, RELAYS[2])

		// This is the exact condition external.tsx checks before short-circuiting
		// to the Yadio HTTPS fallback instead of waiting out a 20s timeout.
		expect(liveness.filter(RELAYS)).toEqual([])
	})

	test('a single healthy relay among three keeps allRelays usable (no premature fallback)', async () => {
		const liveness = freshLiveness()
		await killRelay(liveness, RELAYS[0])
		await killRelay(liveness, RELAYS[1])
		// RELAYS[2] is still up → we must NOT declare everything unhealthy.
		expect(liveness.filter(RELAYS).length).toBe(1)
	})
})

describe('PlebianCurrencyClient — allRelaysUnhealthy() contract', () => {
	const SERVER_PUBKEY = getPublicKey(crypto.getRandomValues(new Uint8Array(32)))

	function client(relays: string[]) {
		return new PlebianCurrencyClient({
			privateKey: crypto.getRandomValues(new Uint8Array(32)),
			relays,
			serverPubkey: SERVER_PUBKEY,
		})
	}

	test('returns true for a client with no configured relays', () => {
		const c = client([])
		expect(c.allRelaysUnhealthy()).toBe(true)
		expect(c.healthyRelays()).toEqual([])
	})

	test('returns false on a cold start with relays (first request is always attempted)', () => {
		const c = client(RELAYS)
		expect(c.allRelaysUnhealthy()).toBe(false)
		expect(c.healthyRelays().length).toBe(RELAYS.length)
		c.close()
	})
})
