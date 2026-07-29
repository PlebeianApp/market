import { afterEach, describe, expect, test } from 'bun:test'
import {
	checkMintProbeDestination,
	createPolicyEnforcedRequest,
	isMintDestinationAllowed,
} from '../../server/auction-validator/mintDestination'
import { refreshAuctionMintReachability } from '../../server/auction-validator/mintReachability'
import {
	createValidatorState,
	setAuctionMintReachability,
	upsertAuction,
	type ValidatorAuctionState,
} from '../../server/auction-validator/state'
import type { MinBidCurve, ParsedAuctionEvent } from '../auction/events'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

const VALIDATOR_PK = 'c'.repeat(64)
const SELLER_PK = 'a'.repeat(64)
const NO_CURVE: MinBidCurve = { shape: 'none', peakMultiplier: 1, raw: '' }

const buildAuction = (mints: string[]): ParsedAuctionEvent => {
	const rawEvent = {
		id: '1'.repeat(64),
		kind: 30408,
		pubkey: SELLER_PK,
		created_at: 1_000,
		content: '',
		tags: mints.map((m) => ['mint', m]),
	} as unknown as NDKEvent
	return {
		rawEvent,
		dTag: 'auction-test',
		sellerPubkey: SELLER_PK,
		coordinate: `30408:${SELLER_PK}:auction-test`,
		rootEventId: rawEvent.id,
		title: 'Auction',
		content: '',
		auctionType: 'english',
		startAt: 1_000,
		endAt: 2_000,
		maxEndAt: 2_100,
		settlementGrace: 3_600,
		currency: 'SAT',
		reserve: 0,
		startingBid: 1_000,
		bidIncrement: 100,
		minBidCurve: NO_CURVE,
		settlementPolicy: 'cashu_p2pk_bidder_path_v1',
		keyScheme: 'hd_p2pk',
		mints,
		p2pkXpub: 'xpub-root',
		auditors: [VALIDATOR_PK],
		auditorQuorum: 1,
		maxSkewSec: 60,
		fallbackDelaySec: 1_800,
		vadiumRatioBps: 10_000,
		schema: 'auction_v1',
	}
}

describe('mint destination policy', () => {
	test('rejects private/loopback/https-mismatched destinations', () => {
		expect(isMintDestinationAllowed('https://mint.example.com').allowed).toBe(true)
		expect(isMintDestinationAllowed('http://mint.example.com').allowed).toBe(false)
		expect(isMintDestinationAllowed('https://127.0.0.1').allowed).toBe(false)
		expect(isMintDestinationAllowed('https://localhost').allowed).toBe(false)
		expect(isMintDestinationAllowed('https://10.0.0.1').allowed).toBe(false)
		expect(isMintDestinationAllowed('https://192.168.1.1').allowed).toBe(false)
		expect(isMintDestinationAllowed('https://169.254.169.254').allowed).toBe(false)
		expect(isMintDestinationAllowed('https://[::1]').allowed).toBe(false)
		expect(isMintDestinationAllowed('https://user:pass@mint.example.com').allowed).toBe(false)
	})

	test('allowInsecureLocalhost permits http://localhost only', () => {
		expect(isMintDestinationAllowed('http://localhost', { allowInsecureLocalhost: true }).allowed).toBe(true)
		expect(isMintDestinationAllowed('http://127.0.0.1', { allowInsecureLocalhost: true }).allowed).toBe(true)
		expect(isMintDestinationAllowed('http://mint.example.com', { allowInsecureLocalhost: true }).allowed).toBe(false)
		expect(isMintDestinationAllowed('https://localhost', { allowInsecureLocalhost: true }).allowed).toBe(true)
	})
})

describe('checkMintProbeDestination — allowlist gate (opt-in + syntactic)', () => {
	test('probing is disabled when no allowlist is configured', () => {
		// No allowedMints → no outbound calls, even for a syntactically
		// valid public https mint.
		expect(checkMintProbeDestination('https://mint.example.com').allowed).toBe(false)
		expect(checkMintProbeDestination('https://mint.example.com', {}).allowed).toBe(false)
		expect(checkMintProbeDestination('https://mint.example.com', { allowedMints: [] }).allowed).toBe(false)
	})

	test('a mint not on the allowlist is rejected', () => {
		expect(checkMintProbeDestination('https://evil.example.com', { allowedMints: ['https://mint.example.com'] }).allowed).toBe(false)
	})

	test('an allowlisted mint that passes the syntactic check is allowed', () => {
		expect(checkMintProbeDestination('https://mint.example.com', { allowedMints: ['https://mint.example.com'] }).allowed).toBe(true)
		// Origin matching: a full endpoint URL matches a base-URL allowlist entry.
		expect(
			checkMintProbeDestination('https://mint.example.com/v1/checkstate', { allowedMints: ['https://mint.example.com'] }).allowed,
		).toBe(true)
		// Trailing slash on the allowlist entry is normalized.
		expect(checkMintProbeDestination('https://mint.example.com', { allowedMints: ['https://mint.example.com/'] }).allowed).toBe(true)
	})

	test('an allowlisted mint that fails the syntactic check is rejected', () => {
		// Private IP on the allowlist still rejected by the syntactic gate.
		expect(checkMintProbeDestination('https://192.168.1.1', { allowedMints: ['https://192.168.1.1'] }).allowed).toBe(false)
	})
})

describe('mint reachability probing boundaries', () => {
	test('disallowed destinations are not contacted and marked unreachable', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction(['https://127.0.0.1', 'https://mint.example.com'])).auctionState

		let contactCount = 0
		const options = {
			mintClient: {
				check: async () => {
					contactCount += 1
					return { states: [] }
				},
			} as any,
		}
		const active = await refreshAuctionMintReachability(auctionState, options, { allowedMints: ['https://mint.example.com'] })

		// Only the public mint was contacted; the loopback mint was not.
		expect(contactCount).toBe(1)
		expect(auctionState.mintReachability.get('https://127.0.0.1')).toBe('unreachable')
		expect(auctionState.mintReachability.get('https://mint.example.com')).toBe('reachable')
		expect(active).toBe(true)
	})

	test('concurrency is bounded by maxConcurrency', async () => {
		const allMints = [
			'https://m1.example.com',
			'https://m2.example.com',
			'https://m3.example.com',
			'https://m4.example.com',
			'https://m5.example.com',
			'https://m6.example.com',
		]
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction(allMints)).auctionState

		let inFlight = 0
		let maxInFlight = 0
		let resolved = 0
		const options = {
			mintClient: {
				check: async () => {
					inFlight += 1
					maxInFlight = Math.max(maxInFlight, inFlight)
					await new Promise((r) => setTimeout(r, 5))
					inFlight -= 1
					resolved += 1
					return { states: [] }
				},
			} as any,
		}
		await refreshAuctionMintReachability(auctionState, options, { maxConcurrency: 2, allowedMints: allMints })

		expect(resolved).toBe(6)
		expect(maxInFlight).toBeLessThanOrEqual(2)
	})

	test('mints beyond the per-auction cap are marked unreachable without probing', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(
			state,
			buildAuction(['https://m1.example.com', 'https://m2.example.com', 'https://m3.example.com']),
		).auctionState

		let contactCount = 0
		const options = {
			mintClient: {
				check: async () => {
					contactCount += 1
					return { states: [] }
				},
			} as any,
		}
		await refreshAuctionMintReachability(auctionState, options, {
			maxMintsPerAuction: 1,
			allowedMints: ['https://m1.example.com', 'https://m2.example.com', 'https://m3.example.com'],
		})

		expect(contactCount).toBe(1)
		expect(auctionState.mintReachability.get('https://m2.example.com')).toBe('unreachable')
		expect(auctionState.mintReachability.get('https://m3.example.com')).toBe('unreachable')
	})

	test('probing is disabled by default — no allowlist means no outbound calls', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction(['https://mint.example.com', 'https://other.example.com'])).auctionState

		let contactCount = 0
		const options = {
			mintClient: {
				check: async () => {
					contactCount += 1
					return { states: [] }
				},
			} as any,
		}
		// No allowedMints configured → probing disabled → no network calls.
		await refreshAuctionMintReachability(auctionState, options)

		expect(contactCount).toBe(0)
		expect(auctionState.mintReachability.get('https://mint.example.com')).toBe('unreachable')
		expect(auctionState.mintReachability.get('https://other.example.com')).toBe('unreachable')
	})

	test('a non-allowlisted mint is not contacted even with probing enabled', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction(['https://mint.example.com', 'https://evil.example.com'])).auctionState

		let contactCount = 0
		const options = {
			mintClient: {
				check: async () => {
					contactCount += 1
					return { states: [] }
				},
			} as any,
		}
		// Only mint.example.com is allowlisted; evil.example.com is not.
		await refreshAuctionMintReachability(auctionState, options, { allowedMints: ['https://mint.example.com'] })

		expect(contactCount).toBe(1)
		expect(auctionState.mintReachability.get('https://mint.example.com')).toBe('reachable')
		expect(auctionState.mintReachability.get('https://evil.example.com')).toBe('unreachable')
	})
})

describe('createPolicyEnforcedRequest — outbound boundary + redirect guard', () => {
	// Restore the real fetch after each test.
	const realFetch = globalThis.fetch
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	test('a disallowed destination is never contacted', async () => {
		const contacted: string[] = []
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			contacted.push(typeof input === 'string' ? input : input.toString())
			return new Response('ok', { status: 200 })
		}) as unknown as typeof globalThis.fetch

		const req = createPolicyEnforcedRequest()
		await expect(req({ endpoint: 'http://169.254.169.254/v1/checkstate', method: 'POST', requestBody: {} })).rejects.toThrow(/not allowed/)
		expect(contacted).toEqual([])
	})

	test('a redirect to a private host is not followed', async () => {
		const contacted: string[] = []
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString()
			contacted.push(url)
			// The allowed configured URL responds with a 302 to a private host.
			if (url === 'https://mint.example.com/v1/checkstate') {
				return new Response(null, { status: 302, headers: { location: 'http://192.168.1.5/secret' } })
			}
			return new Response('ok', { status: 200 })
		}) as unknown as typeof globalThis.fetch

		const req = createPolicyEnforcedRequest({ allowedMints: ['https://mint.example.com'] })
		await expect(req({ endpoint: 'https://mint.example.com/v1/checkstate', method: 'POST', requestBody: {} })).rejects.toThrow(
			/not allowed/,
		)
		// Only the allowed configured URL was contacted; the private redirect target was not.
		expect(contacted).toEqual(['https://mint.example.com/v1/checkstate'])
	})

	test('an allowed destination returning JSON resolves', async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ states: [{ Y: 'y1', state: 'UNSPENT' }] }), { status: 200 })) as unknown as typeof globalThis.fetch

		const req = createPolicyEnforcedRequest({ allowedMints: ['https://mint.example.com'] })
		const res = (await req({ endpoint: 'https://mint.example.com/v1/checkstate', method: 'POST', requestBody: { Ys: ['y1'] } })) as {
			states: unknown[]
		}
		expect(Array.isArray(res.states)).toBe(true)
	})

	test('a syntactically valid but non-allowlisted mint is rejected by the transport (defense in depth)', async () => {
		const contacted: string[] = []
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			contacted.push(typeof input === 'string' ? input : input.toString())
			return new Response('ok', { status: 200 })
		}) as unknown as typeof globalThis.fetch

		// An allowlist is configured, but the endpoint's mint is not on it.
		const req = createPolicyEnforcedRequest({ allowedMints: ['https://trusted.example.com'] })
		await expect(req({ endpoint: 'https://evil.example.com/v1/checkstate', method: 'POST', requestBody: {} })).rejects.toThrow(/not allow/)
		expect(contacted).toEqual([])
	})

	test('no allowlist configured means the transport rejects all mint endpoints', async () => {
		const contacted: string[] = []
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			contacted.push(typeof input === 'string' ? input : input.toString())
			return new Response('ok', { status: 200 })
		}) as unknown as typeof globalThis.fetch

		const req = createPolicyEnforcedRequest()
		await expect(req({ endpoint: 'https://mint.example.com/v1/checkstate', method: 'POST', requestBody: {} })).rejects.toThrow(
			/probing disabled/,
		)
		expect(contacted).toEqual([])
	})
})
