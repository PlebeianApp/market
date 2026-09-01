import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, verifiedSymbol } from 'nostr-tools'
import { VALIDATOR_VERDICT_KIND } from '@/lib/auction/constants'
import type { NostrEvent, NostrFilter } from '@/lib/nostr/io'

type RelayEvent = NostrEvent

let fetchedFilters: NostrFilter[] = []
let relayEvents = new Set<RelayEvent>()

if (!('localStorage' in globalThis)) {
	const items = new Map<string, string>()
	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => items.set(key, value),
			removeItem: (key: string) => items.delete(key),
			clear: () => items.clear(),
		},
		configurable: true,
	})
}

mock.module('@/lib/stores/blacklist', () => ({
	blacklistActions: {
		isBlacklistLoaded: () => false,
		isPubkeyBlacklisted: () => false,
		isProductBlacklisted: () => false,
		isCollectionBlacklisted: () => false,
	},
}))

mock.module('@/lib/stores/ndk', () => ({
	getWriteRelays: () => [],
	ndkStore: {
		state: {
			ndk: null,
			zapNdk: null,
			explicitRelayUrls: [],
			writeRelayUrls: [],
			signer: undefined,
		},
	},
	ndkActions: {
		getNDK: () => ({}),
		fetchEventsWithTimeout: mock(async (filter: NostrFilter) => {
			fetchedFilters.push(filter)
			return relayEvents
		}),
	},
}))

const { fetchAuctionVerdicts } = await import('@/queries/auctions')

const AUCTION_ROOT_EVENT_ID = '1'.repeat(64)
const AUCTION_COORDINATE = `30408:${'a'.repeat(64)}:auction-1`

// Real keypairs: the parse boundary verifies real Schnorr signatures, so the
// fixtures must be genuinely signed (and genuinely forged), not sig-mocked.
const validatorSecretKey = generateSecretKey()
const validatorPubkey = getPublicKey(validatorSecretKey)
const rogueSecretKey = generateSecretKey()
const roguePubkey = getPublicKey(rogueSecretKey)

function verdictEvent(signerSecretKey: Uint8Array, createdAt: number, content = ''): NostrEvent {
	// finalizeEvent caches the successful verification on the event object via
	// nostr-tools' `verifiedSymbol` (verifyEvent short-circuits on it). Strip
	// the cache from any *derived* fixture below so its (in)validity is really
	// checked instead of inherited. Relay-served events never carry the symbol.
	return finalizeEvent(
		{
			kind: VALIDATOR_VERDICT_KIND as unknown as number,
			created_at: createdAt,
			content,
			tags: [
				['d', `${'b'.repeat(64)}:${AUCTION_ROOT_EVENT_ID}:${'c'.repeat(64)}`],
				['p', 'b'.repeat(64)],
				['e', AUCTION_ROOT_EVENT_ID],
				['bid', 'c'.repeat(64)],
				['a', AUCTION_COORDINATE],
				['claim', 'valid_bid_placed'],
				['observed_at', String(createdAt)],
			],
		},
		signerSecretKey,
	)
}

/** A copy of `event` without nostr-tools' cached verification verdict. */
function withoutCachedVerification(event: NostrEvent): NostrEvent {
	const clone = { ...event } as NostrEvent & { [key: symbol]: unknown }
	delete clone[verifiedSymbol]
	return clone
}

describe('auction verdict queries — trust boundary (review #1235 Should-fix 3)', () => {
	beforeEach(() => {
		fetchedFilters = []
		relayEvents = new Set()
	})

	test('backwards compatible: no auditors passed means no authors filter', async () => {
		await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 42, AUCTION_COORDINATE)

		expect(fetchedFilters).toEqual([
			{
				kinds: [VALIDATOR_VERDICT_KIND as unknown as number],
				'#e': [AUCTION_ROOT_EVENT_ID],
				'#a': [AUCTION_COORDINATE],
				limit: 42,
			},
		])
		expect(fetchedFilters[0]).not.toHaveProperty('authors')
	})

	test('sends the configured auditors as the relay authors filter (de-duplicated, sorted)', async () => {
		await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE, [validatorPubkey, roguePubkey, validatorPubkey])

		expect(fetchedFilters.length).toBe(1)
		// The filter authors set is de-duplicated and sorted for a stable query key —
		// derive the expected order rather than assuming a key generation order.
		expect((fetchedFilters[0] as { authors?: string[] }).authors).toEqual([validatorPubkey, roguePubkey].sort())
	})

	test('fails closed: an empty auditor list authorizes nothing and never queries the relay', async () => {
		relayEvents = new Set([verdictEvent(validatorSecretKey, 10)])

		const verdicts = await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE, [])

		expect(verdicts).toEqual([])
		expect(fetchedFilters).toEqual([])
	})

	test('drops unverified events at the parse boundary before they can be rendered', async () => {
		const signed = verdictEvent(validatorSecretKey, 10)
		// A tampered event keeps its (now stale) id/sig but altered content —
		// exactly what a relay or a man-in-the-middle could inject.
		const tampered = { ...withoutCachedVerification(signed), content: 'forged' } as NostrEvent
		const unsigned = { ...withoutCachedVerification(signed), sig: '' } as NostrEvent
		relayEvents = new Set([withoutCachedVerification(signed), tampered, unsigned])

		const verdicts = await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE)

		expect(verdicts.map((event) => event.id)).toEqual([signed.id])
	})

	test('re-checks authors client-side: a properly-signed verdict from a non-auditor is dropped', async () => {
		// The relay ignored the authors filter and served a rogue verdict
		// that is *correctly signed* by its author — signed ≠ authorized.
		const authorized = verdictEvent(validatorSecretKey, 10)
		const rogueSigned = verdictEvent(rogueSecretKey, 20)
		relayEvents = new Set([authorized, rogueSigned])

		const verdicts = await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE, [validatorPubkey])

		expect(verdicts.map((event) => event.pubkey)).toEqual([validatorPubkey])
	})

	test('keeps a properly signed, authorized verdict and returns it newest-first', async () => {
		const older = verdictEvent(validatorSecretKey, 10)
		const newer = verdictEvent(validatorSecretKey, 20)
		relayEvents = new Set([older, newer])

		const verdicts = await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE, [validatorPubkey])

		expect(verdicts.map((event) => event.id)).toEqual([newer.id, older.id])
	})
})
