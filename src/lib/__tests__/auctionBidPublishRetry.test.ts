/**
 * #1235 Blocking 1 — retry-publish idempotency + refund-key ordering.
 *
 * Review contract item 1 (regression test):
 *   - a retry from `mint_succeeded_bid_publish_failed_reclaimable` triggers
 *     NO second `lockAuctionBidFunds` (no fresh Cashu swap/lock at the mint)
 *     and re-uses the recorded bid event id;
 *   - the durable recovery record (refund private key + locked proofs) exists
 *     even when the publish throws.
 *
 * Strategy: run the REAL `publishAuctionBid` against the REAL NDKEvent
 * implementation (real event hashing, real signing) with the nip60 store and
 * the NDK publish surface mocked, and a polyfilled user-scoped localStorage
 * (as in `bidderChainRecords.test.ts`). ADR-0005: zero external network
 * calls — the mint lock and the relay publish are both in-process mocks.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import NDK, { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import type { Proof } from '@cashu/cashu-ts'
import { getPublicKey } from 'nostr-tools'
import { authStore } from '../stores/auth'
import { findBidderRecord, type BidderBidRecord } from '../auction/bidderRecords'

// =============================================================================
// localStorage polyfill — Bun's test runtime doesn't provide one.
// =============================================================================

const installLocalStoragePolyfill = (): void => {
	if (typeof globalThis.localStorage !== 'undefined') return
	const store = new Map<string, string>()
	;(globalThis as { localStorage: Storage }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value)
		},
		removeItem: (key: string) => {
			store.delete(key)
		},
		clear: () => {
			store.clear()
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size
		},
	}
}
installLocalStoragePolyfill()

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_USER_PUBKEY = 'f'.repeat(64)
const SELLER_PK = 'a'.repeat(64)
// A real xpub the project's auctionP2pk module derives from.
const REAL_AUCTION_XPUB = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'

const bidderPrivkeyBytes = new Uint8Array(32).fill(4)
const bidderPrivkeyHex = Array.from(bidderPrivkeyBytes, (b) => b.toString(16).padStart(2, '0')).join('')
const signer: NDKPrivateKeySigner = new NDKPrivateKeySigner(bidderPrivkeyHex)
const ndkInstance = new NDK()
// The bidder's Nostr pubkey as proper 64-char hex — nostr-tools' getPublicKey
// returns hex (noble's secp256k1 one returns raw bytes).
const bidderPubkey = getPublicKey(bidderPrivkeyBytes)

/** Signer whose `sign` throws — used to model a sign failure after the lock. */
const signFailingSigner: NDKSigner = {
	user: async () => ({ pubkey: bidderPubkey }),
	sign: async () => {
		throw new Error('sign failed')
	},
} as unknown as NDKSigner

function dummyProof(amount: number, secret: string): Proof {
	return {
		id: '00' + '1'.repeat(14),
		amount,
		secret,
		C: '02' + '7'.repeat(64),
	}
}

const buildLockResult = (input: { amount: number; locktime?: number }, callIndex: number) => ({
	tokenId: `pending-token-${callIndex}`,
	token: `cashuAeyJ...leg-${callIndex}`,
	// One proof per leg, deterministic secret — hashToCurve runs for real.
	proofs: [dummyProof(input.amount, `["P2PK",{"nonce":"leg-${callIndex}","data":"02${'c'.repeat(64)}","tags":[[]]}]`)],
	amount: input.amount,
	mintUrl: 'https://mint.test',
	lockPubkey: '02' + 'c'.repeat(64),
	locktime: input.locktime ?? 0,
	refundPubkey: '03' + 'e'.repeat(64),
	commitment: 'commitment-' + input.amount,
	keyScheme: 'p2pk',
	derivationPath: 'm/1/2/3',
	childPubkey: '02' + 'd'.repeat(64),
	grantId: 'grant-1',
})

const buildFormData = (amount: number) => {
	const now = Math.floor(Date.now() / 1000)
	return {
		auctionEventId: '1'.repeat(64),
		auctionCoordinates: `30408:${SELLER_PK}:auction-1`,
		amount,
		auctionStartAt: now - 1_000,
		auctionEffectiveEndAt: now + 3_600,
		auctionLocktimeAt: now + 7_200,
		settlementGraceSeconds: 300,
		sellerPubkey: SELLER_PK,
		p2pkXpub: REAL_AUCTION_XPUB,
		mintCandidates: ['https://mint.test'],
	}
}

// =============================================================================
// Mocks — nip60 (mint lock) and ndk (relay publish). No network, ever.
// =============================================================================

const lockAuctionBidFundsMock = mock(async (input: { amount: number; locktime?: number }) =>
	buildLockResult(input, lockAuctionBidFundsMock.mock.calls.length),
)

const updatePendingTokenContextMock = mock(() => ({ tokenId: 'pending-token-1', context: {} }))

/** Raw payloads passed to the relay publish surface, in call order. */
const publishedPayloads: Array<{ id: string; sig?: string; kind: number }> = []
let publishShouldFail = false

const publishEventMock = mock(async (event: NDKEvent) => {
	publishedPayloads.push({ id: event.id, sig: event.sig, kind: event.kind })
	if (publishShouldFail) throw new Error('relay down')
	return new Set(['wss://relay.test'])
})

mock.module('@/lib/stores/nip60', () => ({
	nip60Actions: {
		lockAuctionBidFunds: lockAuctionBidFundsMock,
		updatePendingTokenContext: updatePendingTokenContextMock,
	},
}))

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		publishEvent: publishEventMock,
		getNDK: () => ndkInstance,
		getSigner: () => signer,
	},
}))

// Import the module under test AFTER the mocks are registered (same module
// ordering as `orders.test.ts` — bun applies mock.module to this import).
import { AuctionBidPublishFailedError, publishAuctionBid, republishAuctionBid } from '@/publish/auctions'

// =============================================================================
// Test lifecycle
// =============================================================================

const setAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))

/** Attempt a publish and return the AuctionBidPublishFailedError it throws. */
const publishAndExpectBroadcastFailure = async (amount: number, publishSigner: NDKSigner = signer) => {
	let caught: unknown
	try {
		await publishAuctionBid(buildFormData(amount), publishSigner, ndkInstance)
	} catch (error) {
		caught = error
	}
	expect(caught).toBeInstanceOf(AuctionBidPublishFailedError)
	return caught as AuctionBidPublishFailedError
}

beforeEach(() => {
	localStorage.clear()
	setAuthUser()
	publishedPayloads.length = 0
	publishShouldFail = false
	// Re-arm the mock implementations (do NOT mockReset — that drops them).
	lockAuctionBidFundsMock.mockClear()
	updatePendingTokenContextMock.mockClear()
	publishEventMock.mockClear()
})

// =============================================================================
// Recovery record ordering + idempotent retry
// =============================================================================

describe('publishAuctionBid durable recovery state (#1235 Blocking 1)', () => {
	test('recovery record (refund key + locked proofs) exists even when the relay publish throws', async () => {
		publishShouldFail = true
		const failure = await publishAndExpectBroadcastFailure(500)

		expect(failure.bidEventId).toHaveLength(64)

		// The bidder record — the only durable copy of the refund private key
		// and the full locked proofs — was written BEFORE the publish attempt.
		const record = findBidderRecord(failure.bidEventId) as BidderBidRecord | undefined
		expect(record).toBeDefined()
		expect(record?.refundPrivateKey).toHaveLength(64)
		expect(record?.proofs.length).toBeGreaterThan(0)
		expect(record?.legLockedAmount).toBe(500)
		expect(record?.mintUrl).toBe('https://mint.test')
	})

	test('exactly one lock per publish attempt (no hidden re-lock)', async () => {
		publishShouldFail = true
		await publishAndExpectBroadcastFailure(500)
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)
	})
})

describe('republishAuctionBid idempotent retry (#1235 Blocking 1)', () => {
	test('retry rebroadcasts the EXACT signed kind-1023 — same event id, same signature, zero additional lock/swap', async () => {
		// First attempt: funded + signed, but the relay broadcast fails.
		publishShouldFail = true
		const failure = await publishAndExpectBroadcastFailure(500)
		const bidEventId = failure.bidEventId
		expect(publishedPayloads).toHaveLength(1)
		const firstPayload = publishedPayloads[0]
		expect(firstPayload.sig).toBeTruthy() // the failed attempt was fully signed

		// Retry: relay is back up. The retry must rebroadcast the cached
		// event verbatim — no re-lock, no re-sign, no new event id.
		publishShouldFail = false
		const retriedId = await republishAuctionBid(bidEventId, signer, ndkInstance)

		expect(retriedId).toBe(bidEventId) // same event id
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1) // ZERO additional Cashu swap/lock
		expect(publishedPayloads).toHaveLength(2)
		const retryPayload = publishedPayloads[1]
		expect(retryPayload.id).toBe(bidEventId)
		expect(retryPayload.sig).toBe(firstPayload.sig) // exact same signed event
		expect(retryPayload.kind).toBe(1023)

		// The recovery record still exists (unchanged) for the rebroadcast leg.
		const record = findBidderRecord(bidEventId)
		expect(record?.bidEventId).toBe(bidEventId)
	})

	test('retry after a sign failure re-signs the SAME event id (no re-lock)', async () => {
		// Sign fails AFTER the lock + recovery record + cache write.
		const failure = await publishAndExpectBroadcastFailure(700, signFailingSigner)
		const bidEventId = failure.bidEventId
		expect(publishedPayloads).toHaveLength(0) // never reached the relay
		expect(findBidderRecord(bidEventId)).toBeDefined()

		// Retry with a working signer: re-sign the cached (unsigned) event —
		// the event id is unaffected by the signature, and the mint is not
		// touched again.
		const retriedId = await republishAuctionBid(bidEventId, signer, ndkInstance)
		expect(retriedId).toBe(bidEventId)
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)
		expect(publishedPayloads).toHaveLength(1)
		expect(publishedPayloads[0].id).toBe(bidEventId)
		expect(publishedPayloads[0].sig).toBeTruthy()
	})

	test('successful publish discards the rebroadcast cache — a later republish of the same id refuses', async () => {
		const bidEventId = await publishAuctionBid(buildFormData(900), signer, ndkInstance)
		expect(bidEventId).toHaveLength(64)
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)

		// Nothing is left to rebroadcast: the retry affordance must refuse
		// rather than silently re-running the (re-locking) pipeline.
		let caught: unknown
		try {
			await republishAuctionBid(bidEventId, signer, ndkInstance)
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toContain('No cached bid event')
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1) // still no re-lock
		expect(publishedPayloads).toHaveLength(1)
	})

	test('republish of an unknown id throws without publishing anything', async () => {
		const unknownId = 'f'.repeat(64)
		let caught: unknown
		try {
			await republishAuctionBid(unknownId, signer, ndkInstance)
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toContain('No cached bid event')
		expect(publishEventMock).not.toHaveBeenCalled()
		expect(lockAuctionBidFundsMock).not.toHaveBeenCalled()
	})

	test('a republish that fails again throws AuctionBidPublishFailedError with the same id (retryable again)', async () => {
		publishShouldFail = true
		const failure = await publishAndExpectBroadcastFailure(1_100)
		const bidEventId = failure.bidEventId

		// Retry while the relay is STILL down: the rebroadcast fails, the state
		// stays retryable, and no re-lock happened.
		let retryCaught: unknown
		try {
			await republishAuctionBid(bidEventId, signer, ndkInstance)
		} catch (error) {
			retryCaught = error
		}
		expect(retryCaught).toBeInstanceOf(AuctionBidPublishFailedError)
		expect((retryCaught as AuctionBidPublishFailedError).bidEventId).toBe(bidEventId)
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)

		// Third time's the charm — still the exact same event.
		publishShouldFail = false
		const retriedId = await republishAuctionBid(bidEventId, signer, ndkInstance)
		expect(retriedId).toBe(bidEventId)
		expect(publishedPayloads[2].sig).toBe(publishedPayloads[0].sig)
	})
})
