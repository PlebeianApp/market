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
import {
	findBidderRecord,
	findPreLockRecoveryRecordByRefundPubkey,
	loadBidderRecords,
	loadPreLockRecoveryRecords,
	type BidderBidRecord,
} from '../auction/bidderRecords'
import { APP_AUCTION_DLEQ_ROLLOUT_START_AT } from '../auction/constants'

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
		// Grandfathered pre-rollout start (ADR-0011 Decision 7): these tests
		// exercise #1235 retry/idempotency logic, not DLEQ collateral
		// verification. A post-rollout start would route them through the
		// DLEQ-required path and fail on the dummyProof fixtures lacking
		// NUT-12 metadata. Pin start_at just below the rollout boundary so
		// they stay on the pre-rollout (non-DLEQ) path regardless of when
		// they run.
		auctionStartAt: APP_AUCTION_DLEQ_ROLLOUT_START_AT - 1,
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

const lockAuctionBidFundsMock = mock(async (input: { amount: number; locktime?: number }) => {
	// #1235 round-3 B1 test hook: an injected throw models a lock failure
	// (raw pre-lock validation error, or AuctionBidLockMutationPossibleError).
	if (lockShouldThrow) throw lockShouldThrow
	return buildLockResult(input, lockAuctionBidFundsMock.mock.calls.length)
})

let lockShouldThrow: unknown = null

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

// #1235 round-3 B1: capture the REAL nip60 surface BEFORE registering the
// mock — the publish layer's instanceof check needs the same
// AuctionBidLockMutationPossibleError class reference, and the mock must
// re-export it (bun re-imports the module graph when mock.module runs, so
// publish/auctions binds to the mocked module).
const realNip60 = await import('@/lib/stores/nip60')

mock.module('@/lib/stores/nip60', () => ({
	nip60Actions: {
		lockAuctionBidFunds: lockAuctionBidFundsMock,
		updatePendingTokenContext: updatePendingTokenContextMock,
	},
	AuctionBidLockMutationPossibleError: realNip60.AuctionBidLockMutationPossibleError,
}))

// Import the module under test AFTER the mocks are registered (same module
// ordering as `orders.test.ts` — bun applies mock.module to this import).
import {
	AuctionBidLockedButUnpublishedError,
	AuctionBidLockOutcomeUncertainError,
	AuctionBidPreLockRecordWriteFailedError,
	AuctionBidPublishFailedError,
	publishAuctionBid,
	republishAuctionBid,
} from '@/publish/auctions'

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
	lockShouldThrow = null
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

// =============================================================================
// #1235 round-3 B2 — retry identity binding: an unsigned cached event must
// only ever be re-signed by the ORIGINAL bidder. NDK's `sign` overwrites the
// event's pubkey with the active signer's user, so re-signing an A-authored
// event with signer B would publish a B-authored kind-1023 carrying A's lock
// secrets under a DRIFTED event id — the original bidder record (refund key +
// proofs) exists only under the original id. Both guards must refuse WITHOUT
// publishing and WITHOUT discarding the cached entry.
// =============================================================================

describe('republishAuctionBid retry identity binding (#1235 round-3 B2)', () => {
	test('cached unsigned event for A → retry with signer B → reject before publish, zero additional mint interaction', async () => {
		// Arrange: the cache holds the UNSIGNED event authored by A (the sign
		// failed after the lock + recovery record + cache write).
		const failure = await publishAndExpectBroadcastFailure(700, signFailingSigner)
		const bidEventId = failure.bidEventId
		expect(publishedPayloads).toHaveLength(0) // never reached the relay
		expect(findBidderRecord(bidEventId)).toBeDefined()

		// Account switch A → B, then retry the republish with B's signer.
		const signerB = new NDKPrivateKeySigner('5'.repeat(64))
		let caught: unknown
		try {
			await republishAuctionBid(bidEventId, signerB, ndkInstance)
		} catch (error) {
			caught = error
		}

		// Refused pre-sign with an actionable mismatch message.
		expect(caught).toBeInstanceOf(Error)
		const message = (caught as Error).message
		expect(message).toContain('Refusing to republish auction bid')
		expect(message).toContain('cached bid was created by')
		expect(message).toContain('but the active signer is')
		expect(message).toContain('cached event is preserved')

		// Zero additional mint interaction and zero relay interaction.
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)
		expect(publishEventMock).not.toHaveBeenCalled()
		expect(publishedPayloads).toHaveLength(0)

		// The ORIGINAL cache entry survived the refusal (never discarded on
		// failure) — retrying with the original bidder's signer still
		// rebroadcasts the SAME event id.
		const retriedId = await republishAuctionBid(bidEventId, signer, ndkInstance)
		expect(retriedId).toBe(bidEventId)
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1) // still no re-lock
		expect(publishedPayloads).toHaveLength(1)
		expect(publishedPayloads[0].id).toBe(bidEventId)
		expect(publishedPayloads[0].sig).toBeTruthy()
	})

	test('post-sign identity drift (signer user() flips mid-sign) → republish refuses, nothing published, cache preserved', async () => {
		const failure = await publishAndExpectBroadcastFailure(700, signFailingSigner)
		const bidEventId = failure.bidEventId

		// A stateful signer whose identity flips between the pre-sign guard's
		// `user()` call and `sign`'s internal `author` assignment — `sign` then
		// re-keys the event's pubkey and recomputes a DIFFERENT event id.
		const otherPubkey = getPublicKey(new Uint8Array(32).fill(9))
		let userCalls = 0
		const driftingSigner = {
			user: async () => {
				userCalls += 1
				return { pubkey: userCalls === 1 ? bidderPubkey : otherPubkey }
			},
			sign: async () => 'f'.repeat(128),
		} as unknown as NDKSigner

		let caught: unknown
		try {
			await republishAuctionBid(bidEventId, driftingSigner, ndkInstance)
		} catch (error) {
			caught = error
		}

		// The pre-sign guard passed (first user() → A), but the post-sign guard
		// catches the re-keyed event: NOTHING was published.
		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toContain('re-signing produced a different event id')
		expect(publishEventMock).not.toHaveBeenCalled()
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)

		// Cache preserved: the original unsigned A event is still retryable
		// with the original bidder's real signer — same event id.
		const retriedId = await republishAuctionBid(bidEventId, signer, ndkInstance)
		expect(retriedId).toBe(bidEventId)
		expect(publishedPayloads).toHaveLength(1)
		expect(publishedPayloads[0].id).toBe(bidEventId)
	})
})

// =============================================================================
// #1235 follow-up 3 — post-lock error model: locked-but-unpublished failures
// must be DISTINCT from publish-failed-with-id failures, so the funding
// lifecycle never falls back to the full re-locking pipeline for a leg whose
// funds are already locked. Two injection points, both AFTER the lock:
//
//   (i)  `toNostrEvent` throws — no event id exists yet, no recovery record,
//        no cache entry. Funds locked.
//   (ii) The STRICT bidder-record write fails (storage quota/disabled) — the
//        refund private key is NOT durably persisted, so the publish must
//        fail CLOSED instead of broadcasting a locked leg with no recoverable
//        refund key.
// =============================================================================

describe('publishAuctionBid post-lock error model (#1235 follow-up 3)', () => {
	test('(i) event finalization failure surfaces the DISTINCT locked error carrying the lock tokenId — never a bare error', async () => {
		// Inject a throw at toNostrEvent (real NDKEvent class, prototype-level
		// stub, restored immediately) — the failure happens AFTER
		// lockAuctionBidFunds but BEFORE the event id exists.
		const originalToNostrEvent = NDKEvent.prototype.toNostrEvent
		let caught: unknown
		try {
			NDKEvent.prototype.toNostrEvent = async function () {
				throw new Error('toNostrEvent exploded')
			}
			try {
				await publishAuctionBid(buildFormData(500), signer, ndkInstance)
			} catch (error) {
				caught = error
			}
		} finally {
			NDKEvent.prototype.toNostrEvent = originalToNostrEvent
		}

		// Distinct, identifiable error class — NOT a bare Error, and NOT
		// AuctionBidPublishFailedError (there is no id to rebroadcast).
		expect(caught).toBeInstanceOf(AuctionBidLockedButUnpublishedError)
		expect(caught).not.toBeInstanceOf(AuctionBidPublishFailedError)
		const lockedError = caught as AuctionBidLockedButUnpublishedError
		// Carries the lock result's tokenId — the pending-token record the
		// locked proofs live on, reclaimable after the refund timelock.
		expect(lockedError.lockTokenId).toBe('pending-token-1')
		expect(lockedError.bidEventId).toBeNull() // id never finalized
		expect((lockedError.cause as Error).message).toBe('toNostrEvent exploded')

		// The lock ran EXACTLY once; the bid was never built or broadcast.
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)
		expect(publishEventMock).not.toHaveBeenCalled()
		// No recovery record could exist (id never finalized) — the leg's
		// ONLY durable trace is the wallet's pending token (tokenId above).
		expect(updatePendingTokenContextMock).not.toHaveBeenCalled()
	})

	test('(ii) storage failure at the bidder-record write fails CLOSED — surfaced as the distinct locked error, never a silent success', async () => {
		// The lock result's first call gets tokenId 'pending-token-1' (call
		// index 0 — see buildLockResult).
		let caught: unknown
		const originalSetItem = localStorage.setItem.bind(localStorage)
		let bidderRecordWriteFailed = false
		try {
			// Simulate a quota/serialization failure scoped to the bidder
			// records key — every other storage write keeps working.
			localStorage.setItem = (key: string, _value: string) => {
				if (key.startsWith('auction_bidder_records_v1')) {
					bidderRecordWriteFailed = true
					throw new Error('QuotaExceededError: setItem failed')
				}
				originalSetItem(key, _value)
			}
			try {
				await publishAuctionBid(buildFormData(600), signer, ndkInstance)
			} catch (error) {
				caught = error
			}
		} finally {
			localStorage.setItem = originalSetItem
		}

		// The bidder-record write genuinely failed (the injection fired).
		expect(bidderRecordWriteFailed).toBe(true)

		// Fail-closed: the publish is ABORTED with the distinct locked error
		// (event id WAS finalized here, but without the durable recovery
		// record the leg is NOT safely rebroadcastable — the refund key is
		// lost, so broadcasting would strand the locked leg).
		expect(caught).toBeInstanceOf(AuctionBidLockedButUnpublishedError)
		expect(caught).not.toBeInstanceOf(AuctionBidPublishFailedError)
		const lockedError = caught as AuctionBidLockedButUnpublishedError
		expect(lockedError.lockTokenId).toBe('pending-token-1')
		expect(lockedError.bidEventId).toHaveLength(64) // diagnostics only
		expect((lockedError.cause as Error).message).toContain('QuotaExceededError')

		// The locked leg was NEVER broadcast (fail closed, not silent success).
		expect(publishEventMock).not.toHaveBeenCalled()
		// No recovery record was persisted — retrying via the full pipeline
		// (re-lock) is exactly what the distinct error forbids.
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)
	})

	test('locked-but-unpublished legs are retryable ONLY via reclaim — the distinct error is not an AuctionBidPublishFailedError, so no rebroadcast affordance exists', () => {
		// The hook maps AuctionBidPublishFailedError → publishedBidEventId
		// (rebroadcast retry) and AuctionBidLockedButUnpublishedError →
		// lockedUnpublishedTokenId (reclaim-only). The two classes must stay
		// distinct siblings — never a subclass relationship, or the
		// rebroadcast affordance would leak into reclaim-only legs.
		const publishFailed = new AuctionBidPublishFailedError('f'.repeat(64), new Error('relay down'))
		const locked = new AuctionBidLockedButUnpublishedError('pending-token-1', new Error('storage'), 'a'.repeat(64))
		expect(publishFailed).not.toBeInstanceOf(AuctionBidLockedButUnpublishedError)
		expect(locked).not.toBeInstanceOf(AuctionBidPublishFailedError)
		expect(publishFailed.bidEventId).toBe('f'.repeat(64))
		expect(locked.lockTokenId).toBe('pending-token-1')
	})
})

// =============================================================================
// #1235 round-3 B1 — pre-lock recovery record: the refund authority (the
// leg's refund PRIVATE KEY) must be durably observable BEFORE the mint lock
// call that could consume it, with CONFIRMED-WRITE semantics (strict save +
// read-back). A persist failure must abort the publish with ZERO mint
// interaction; a mutation-possible lock failure must surface the DISTINCT
// uncertain error (never a bare error) and PRESERVE the record.
// =============================================================================

describe('pre-lock recovery record (#1235 round-3 B1)', () => {
	test('pre-lock recovery write fails → AuctionBidPreLockRecordWriteFailedError → zero mint interaction', async () => {
		const originalSetItem = localStorage.setItem.bind(localStorage)
		let preLockWriteFailed = false
		try {
			// Storage fails for the pre-lock recovery key only — everything
			// else keeps working.
			localStorage.setItem = (key: string, _value: string) => {
				if (key.startsWith('auction_bid_pre_lock_recovery_v1')) {
					preLockWriteFailed = true
					throw new Error('QuotaExceededError: setItem failed')
				}
				originalSetItem(key, _value)
			}
			let caught: unknown
			try {
				await publishAuctionBid(buildFormData(500), signer, ndkInstance)
			} catch (error) {
				caught = error
			}

			// The injection genuinely fired (the write was attempted).
			expect(preLockWriteFailed).toBe(true)

			// Fail-closed ordering max: the mint lock was NEVER attempted —
			// provably zero mint interaction.
			expect(caught).toBeInstanceOf(AuctionBidPreLockRecordWriteFailedError)
			expect(lockAuctionBidFundsMock).not.toHaveBeenCalled()
			// Nothing was broadcast, and no residue exists: no bidder record,
			// no pre-lock record (the write failed, the read-back guards it).
			expect(publishEventMock).not.toHaveBeenCalled()
			expect(loadBidderRecords()).toHaveLength(0)
			expect(Object.keys(loadPreLockRecoveryRecords())).toHaveLength(0)
		} finally {
			localStorage.setItem = originalSetItem
		}
	})

	test('mutation-possible lock error surfaces the DISTINCT uncertain error — never a bare error, record preserved', async () => {
		lockShouldThrow = new realNip60.AuctionBidLockMutationPossibleError({
			mintUrl: 'https://mint.test',
			amount: 500,
			lockPubkey: '02' + 'c'.repeat(64),
			refundPubkey: '03' + 'e'.repeat(64),
			locktime: 0,
			cause: new Error('swap send failed mid-flight'),
		})

		let caught: unknown
		try {
			await publishAuctionBid(buildFormData(500), signer, ndkInstance)
		} catch (error) {
			caught = error
		}

		// The distinct uncertain error — a SIBLING of the two existing tiers
		// (never a subclass, never a bare error).
		expect(caught).toBeInstanceOf(AuctionBidLockOutcomeUncertainError)
		expect(caught).not.toBeInstanceOf(AuctionBidPublishFailedError)
		expect(caught).not.toBeInstanceOf(AuctionBidLockedButUnpublishedError)
		const uncertain = caught as AuctionBidLockOutcomeUncertainError
		expect(uncertain.recoveryRecordId).toHaveLength(36) // uuid
		expect(uncertain.mintUrl).toBe('https://mint.test')
		expect(uncertain.legAmount).toBe(500)
		expect((uncertain.cause as Error).message).toContain('swap send failed mid-flight')

		// The lock was attempted EXACTLY once; nothing was broadcast.
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)
		expect(publishEventMock).not.toHaveBeenCalled()

		// The pre-lock record SURVIVES the uncertain outcome — it is the
		// refund authority for this leg (reclaim after the refund timelock).
		const record = findPreLockRecoveryRecordByRefundPubkey(uncertain.refundPubkey)
		expect(record).toBeDefined()
		expect(record?.id).toBe(uncertain.recoveryRecordId)
		expect(record?.refundPrivateKey).toHaveLength(64)
		expect(record?.legLockAmount).toBe(500)
	})

	test('RAW pre-lock lock error (provably nothing mutated) → pre-lock record removed, raw error rethrown', async () => {
		lockShouldThrow = new Error('No trusted mint has 500 sats.')

		let caught: unknown
		try {
			await publishAuctionBid(buildFormData(500), signer, ndkInstance)
		} catch (error) {
			caught = error
		}

		// Raw pre-mint validation errors stay RAW: a full re-submit is
		// provably safe (nothing was mutated at the mint).
		expect(caught).not.toBeInstanceOf(AuctionBidLockOutcomeUncertainError)
		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toContain('No trusted mint has 500 sats.')

		// The pre-lock record was removed — no residue for a leg that never
		// reached the mint.
		expect(Object.keys(loadPreLockRecoveryRecords())).toHaveLength(0)
		expect(lockAuctionBidFundsMock).toHaveBeenCalledTimes(1)
		expect(publishEventMock).not.toHaveBeenCalled()
	})

	test('successful publish supersedes the pre-lock record (no residue once the full bidder record exists)', async () => {
		const bidEventId = await publishAuctionBid(buildFormData(900), signer, ndkInstance)
		expect(bidEventId).toHaveLength(64)
		// The full bidder record exists and the pre-lock record is gone.
		expect(findBidderRecord(bidEventId)).toBeDefined()
		expect(Object.keys(loadPreLockRecoveryRecords())).toHaveLength(0)
	})
})

// =============================================================================
// #1235 round-3 fix 5 (felixfelix #11) — the uncertain-error copy must gate
// the reclaim promise on a durably persisted pending token. When the wallet's
// STRICT pending-token save never succeeded, the leg is record-only: the
// wallet holds no durable observation of the mint-issued proofs, so claiming
// "reclaimable from the wallet" would promise a reclaim the app cannot
// perform.
// =============================================================================

describe('AuctionBidLockOutcomeUncertainError reclaim copy is gated on pendingTokenPersisted (#1235 round-3 fix 5)', () => {
	const baseParams = {
		recoveryRecordId: '11111111-2222-3333-4444-555555555555',
		mintUrl: 'https://mint.test',
		legAmount: 500,
		refundPubkey: '03' + 'e'.repeat(64),
		cause: new Error('swap send failed mid-flight'),
	}

	test('pendingTokenPersisted: true → the existing reclaim-after-timelock copy stays', () => {
		const persisted = new AuctionBidLockOutcomeUncertainError({ ...baseParams, pendingTokenPersisted: true })
		expect(persisted.pendingTokenPersisted).toBe(true)
		expect(persisted.message).toContain('reclaimable from the wallet once the refund timelock opens')
		expect(persisted.message).not.toContain('could not be observed')
		// Shared copy: the uncertain outcome and the no-second-lock stance.
		expect(persisted.message).toContain('uncertain')
		expect(persisted.message).toContain('No second lock was attempted')
	})

	test('pendingTokenPersisted: false or omitted (honest default) → record-only copy, never a wallet-reclaim promise', () => {
		const recordOnly = new AuctionBidLockOutcomeUncertainError({ ...baseParams })
		expect(recordOnly.pendingTokenPersisted).toBe(false)
		expect(recordOnly.message).toContain('could not be observed by the wallet and may not be recoverable in-app')
		expect(recordOnly.message).toContain('a recovery record with your refund key was saved')
		expect(recordOnly.message).not.toContain('reclaimable')

		const explicitFalse = new AuctionBidLockOutcomeUncertainError({ ...baseParams, pendingTokenPersisted: false })
		expect(explicitFalse.pendingTokenPersisted).toBe(false)
		expect(explicitFalse.message).toBe(recordOnly.message)
	})
})
