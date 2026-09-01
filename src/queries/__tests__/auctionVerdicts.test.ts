import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { VALIDATOR_VERDICT_KIND } from '@/lib/auction/constants'
import type { NostrEvent, NostrFilter } from '@/lib/nostr/io'

type RelayEvent = NostrEvent

let fetchedFilters: NostrFilter[] = []
let relayEvents = new Set<RelayEvent>()
let verifyEventResult: ((event: NostrEvent) => boolean) | null = null

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

// Mock only the signature-verification seam that fetchAuctionVerdicts uses, so
// each test controls which events pass/fail verification deterministically.
// Never mock 'nostr-tools' itself: bun applies mock.module process-wide for the
// whole test run, which would replace the real verifyEvent for every other test
// file in the suite (liveChat.test.ts mocks this same seam for the same reason).
mock.module('@/lib/nostr/event-signature', () => ({
	verifyNostrEventSignature: mock((event: NostrEvent) => {
		if (verifyEventResult) return verifyEventResult(event)
		// Default: accept events that carry a signature, reject unsigned ones.
		return typeof event.sig === 'string' && event.sig.length > 0
	}),
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

// Real keypairs give the fixtures realistic pubkeys/ids; signature validity is
// controlled via the mocked seam above, not via nostr-tools crypto.
const validatorSecretKey = generateSecretKey()
const validatorPubkey = getPublicKey(validatorSecretKey)
const rogueSecretKey = generateSecretKey()
const roguePubkey = getPublicKey(rogueSecretKey)

function verdictEvent(signerSecretKey: Uint8Array, createdAt: number, content = ''): NostrEvent {
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

describe('auction verdict queries — trust boundary (review #1235 Should-fix 3)', () => {
	beforeEach(() => {
		fetchedFilters = []
		relayEvents = new Set()
		verifyEventResult = null
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
		// A tampered event keeps its (now stale) id/sig but altered content,
		// and an unsigned event carries no signature — both must be dropped.
		const tampered = { ...signed, content: 'forged' } as NostrEvent
		const unsigned = { ...signed, sig: '' } as NostrEvent
		relayEvents = new Set([signed, tampered, unsigned])

		// Control the seam so only the genuine signed event passes verification.
		verifyEventResult = (event) => event === signed

		const verdicts = await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE)

		expect(verdicts.map((event) => event.id)).toEqual([signed.id])
	})

	test('re-checks authors client-side: a properly-signed verdict from a non-auditor is dropped', async () => {
		// The relay ignored the authors filter and served a rogue verdict that
		// passes signature verification — signed ≠ authorized, so the author
		// re-check must be what drops it.
		const authorized = verdictEvent(validatorSecretKey, 10)
		const rogueSigned = verdictEvent(rogueSecretKey, 20)
		relayEvents = new Set([authorized, rogueSigned])

		verifyEventResult = () => true

		const verdicts = await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE, [validatorPubkey])

		expect(verdicts.map((event) => event.pubkey)).toEqual([validatorPubkey])
	})

	test('keeps a properly signed, authorized verdict and returns it newest-first', async () => {
		const older = verdictEvent(validatorSecretKey, 10)
		const newer = verdictEvent(validatorSecretKey, 20)
		relayEvents = new Set([older, newer])

		verifyEventResult = () => true

		const verdicts = await fetchAuctionVerdicts(AUCTION_ROOT_EVENT_ID, 500, AUCTION_COORDINATE, [validatorPubkey])

		expect(verdicts.map((event) => event.id)).toEqual([newer.id, older.id])
	})
})
