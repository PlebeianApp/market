import { describe, expect, test } from 'bun:test'
import type { NDKEvent, NDKFilter } from '@/lib/nostr/ndk-events'
import { ndkActions } from '@/lib/stores/ndk'
import {
	fetchProductCatalogByPubkey,
	fetchProductSelectionEvents,
	fetchProductsByPubkey,
	productCatalogByPubkeyQueryOptions,
	productsByPubkeyQueryOptions,
} from '../products'
import { safeNpubEncode } from '@/lib/utils'

const VALID_PUBKEY = 'a'.repeat(64)
const HEX_D_TAG = 'b'.repeat(64)
const LEGACY_EVENT_ID = 'd'.repeat(64)

describe('productsByPubkeyQueryOptions', () => {
	test('disables the query while the pubkey is empty', () => {
		const options = productsByPubkeyQueryOptions('', true)

		expect(options.enabled).toBe(false)
	})

	test('disables the query for a malformed pubkey', () => {
		const options = productsByPubkeyQueryOptions('not-a-valid-pubkey')

		expect(options.enabled).toBe(false)
	})

	test('enables the query for a valid hex pubkey', () => {
		const options = productsByPubkeyQueryOptions(VALID_PUBKEY)

		expect(options.enabled).toBe(true)
	})

	test('caller composition: options.enabled && isAuthenticated stays false for malformed truthy input', () => {
		// Simulates the dashboard products route combining the factory guard
		// with its own isAuthenticated condition. A truthy-but-malformed pubkey
		// must still disable the query even when isAuthenticated is true.
		const options = productsByPubkeyQueryOptions('not-hex-but-truthy')
		const combinedEnabled = options.enabled && true // isAuthenticated = true

		expect(combinedEnabled).toBe(false)
	})

	test('caller composition: options.enabled && isAuthenticated is true for valid pubkey + auth', () => {
		const options = productsByPubkeyQueryOptions(VALID_PUBKEY)
		const combinedEnabled = options.enabled && true

		expect(combinedEnabled).toBe(true)
	})
})

describe('fetchProductsByPubkey direct-call guard', () => {
	test('throws on malformed pubkey without touching NDK (zero relay I/O)', () => {
		// isValidHexKey check fires before ndkActions.getNDK() is called,
		// so no NDK instance is created and no relay request is issued.
		expect(() => fetchProductsByPubkey('not-hex')).toThrow('invalid seller pubkey')
	})

	test('throws on empty pubkey without touching NDK', () => {
		expect(() => fetchProductsByPubkey('')).toThrow('invalid seller pubkey')
	})

	test('throws on whitespace pubkey without touching NDK', () => {
		expect(() => fetchProductsByPubkey('   ')).toThrow('invalid seller pubkey')
	})
})

describe('fetchProductSelectionEvents coordinate identity', () => {
	test('uses a normal d-tag coordinate without attempting an event-ID fallback', async () => {
		const product = {
			id: 'simple-event',
			kind: 30402,
			pubkey: VALID_PUBKEY,
			created_at: 1,
			content: '',
			tags: [
				['d', 'simple-product'],
				['type', 'simple', 'physical'],
			],
		} as unknown as NDKEvent
		const requestedAddresses: unknown[] = []
		const realGetNDK = ndkActions.getNDK

		try {
			;(ndkActions as { getNDK: () => unknown }).getNDK = () => ({
				fetchEvent: async (address: unknown) => {
					requestedAddresses.push(address)
					return product
				},
			})

			const selection = await fetchProductSelectionEvents('simple-product', VALID_PUBKEY)

			expect(requestedAddresses).toHaveLength(1)
			expect(String(requestedAddresses[0]).startsWith('naddr1')).toBe(true)
			expect(selection?.identity).toEqual({
				source: 'coordinate',
				requestedId: 'simple-product',
				canonicalDTag: 'simple-product',
			})
		} finally {
			;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
		}
	})

	test('uses the exact seller coordinate for a 64-hex d-tag', async () => {
		const product = {
			id: 'c'.repeat(64),
			kind: 30402,
			pubkey: VALID_PUBKEY,
			created_at: 1,
			content: '',
			tags: [
				['d', HEX_D_TAG],
				['type', 'simple', 'physical'],
			],
		} as unknown as NDKEvent
		const requestedAddresses: unknown[] = []
		const realGetNDK = ndkActions.getNDK

		try {
			;(ndkActions as { getNDK: () => unknown }).getNDK = () => ({
				fetchEvent: async (address: unknown) => {
					requestedAddresses.push(address)
					return product
				},
			})

			const selection = await fetchProductSelectionEvents(HEX_D_TAG, VALID_PUBKEY)

			expect(requestedAddresses).toHaveLength(1)
			expect(requestedAddresses[0]).not.toBe(HEX_D_TAG)
			expect(String(requestedAddresses[0]).startsWith('naddr1')).toBe(true)
			expect(selection?.selected.pubkey).toBe(VALID_PUBKEY)
			expect(selection?.selected.kind).toBe(30402)
			expect(selection?.selected.tags.find((tag) => tag[0] === 'd')?.[1]).toBe(HEX_D_TAG)
			expect(selection?.identity?.source).toBe('coordinate')
		} finally {
			;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
		}
	})

	test('maps an old detail-page event-ID cart row to its exact canonical coordinate', async () => {
		const legacyEvent = {
			id: LEGACY_EVENT_ID,
			kind: 30402,
			pubkey: VALID_PUBKEY,
			created_at: 1,
			content: '',
			tags: [
				['d', 'legacy-detail-product'],
				['type', 'simple', 'physical'],
			],
		} as unknown as NDKEvent
		const canonicalEvent = { ...legacyEvent, id: 'e'.repeat(64), created_at: 2 } as unknown as NDKEvent
		const requestedAddresses: unknown[] = []
		const realGetNDK = ndkActions.getNDK
		const realConnect = ndkActions.connect
		const realFetchEventsWithTimeout = ndkActions.fetchEventsWithTimeout

		try {
			;(ndkActions as { getNDK: () => unknown }).getNDK = () => ({
				fetchEvent: async (address: unknown) => {
					requestedAddresses.push(address)
					return requestedAddresses.length === 1 ? null : canonicalEvent
				},
			})
			;(ndkActions as { connect: () => Promise<void> }).connect = async () => {}
			;(ndkActions as unknown as { fetchEventsWithTimeout: () => Promise<Set<NDKEvent>> }).fetchEventsWithTimeout = async () => {
				requestedAddresses.push(LEGACY_EVENT_ID)
				return new Set([legacyEvent])
			}

			const selection = await fetchProductSelectionEvents(LEGACY_EVENT_ID, VALID_PUBKEY)

			expect(requestedAddresses).toHaveLength(3)
			expect(String(requestedAddresses[0]).startsWith('naddr1')).toBe(true)
			expect(requestedAddresses[1]).toBe(LEGACY_EVENT_ID)
			expect(String(requestedAddresses[2]).startsWith('naddr1')).toBe(true)
			expect(selection?.selected.id).toBe(canonicalEvent.id)
			expect(selection?.identity).toEqual({
				source: 'legacy-event-id',
				requestedId: LEGACY_EVENT_ID,
				canonicalDTag: 'legacy-detail-product',
			})
		} finally {
			;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
			;(ndkActions as { connect: unknown }).connect = realConnect
			;(ndkActions as { fetchEventsWithTimeout: unknown }).fetchEventsWithTimeout = realFetchEventsWithTimeout
		}
	})

	test('fails closed when the legacy event is missing or belongs to another seller', async () => {
		const foreignEvent = {
			id: LEGACY_EVENT_ID,
			kind: 30402,
			pubkey: 'f'.repeat(64),
			created_at: 1,
			content: '',
			tags: [['d', 'foreign-product']],
		} as unknown as NDKEvent
		const realGetNDK = ndkActions.getNDK
		const realConnect = ndkActions.connect
		const realFetchEventsWithTimeout = ndkActions.fetchEventsWithTimeout

		try {
			let eventIdResult: NDKEvent | null = null
			;(ndkActions as { getNDK: () => unknown }).getNDK = () => ({
				fetchEvent: async () => null,
			})
			;(ndkActions as { connect: () => Promise<void> }).connect = async () => {}
			;(ndkActions as unknown as { fetchEventsWithTimeout: () => Promise<Set<NDKEvent>> }).fetchEventsWithTimeout = async () =>
				eventIdResult ? new Set([eventIdResult]) : new Set()

			expect(await fetchProductSelectionEvents(LEGACY_EVENT_ID, VALID_PUBKEY)).toBeNull()
			eventIdResult = foreignEvent
			expect(await fetchProductSelectionEvents(LEGACY_EVENT_ID, VALID_PUBKEY)).toBeNull()
		} finally {
			;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
			;(ndkActions as { connect: unknown }).connect = realConnect
			;(ndkActions as { fetchEventsWithTimeout: unknown }).fetchEventsWithTimeout = realFetchEventsWithTimeout
		}
	})
})

describe('fetchProductCatalogByPubkey completeness', () => {
	test('does not keep price and stock fresh for an added five-minute window', () => {
		const options = productCatalogByPubkeyQueryOptions(VALID_PUBKEY)

		expect(options.staleTime).toBeUndefined()
	})

	test('marks a cap-sized raw read incomplete even when policy filtering leaves fewer events', async () => {
		const rawEvents = Array.from({ length: 500 }, (_, index) => {
			const isFilteredSpam = index === 0
			const tags: string[][] = [
				['d', `product-${index}`],
				['title', isFilteredSpam ? 'journey widget' : `Product ${index}`],
				['type', 'simple', 'physical'],
				['visibility', 'on-sale'],
				['stock', '1'],
				['price', isFilteredSpam ? '700' : '1', 'SAT'],
			]
			return {
				id: index.toString(16).padStart(64, '0'),
				kind: 30402,
				pubkey: VALID_PUBKEY,
				created_at: index + 1,
				content: '',
				tags,
				tagValue: (name: string) => tags.find((tag) => tag[0] === name)?.[1],
			} as unknown as NDKEvent
		})
		const realGetNDK = ndkActions.getNDK
		const realFetchEventsWithTimeout = ndkActions.fetchEventsWithTimeout

		try {
			;(ndkActions as { getNDK: () => unknown }).getNDK = () => ({})
			;(ndkActions as { fetchEventsWithTimeout: unknown }).fetchEventsWithTimeout = (async (filter: NDKFilter) => {
				expect(filter.limit).toBe(500)
				return new Set(rawEvents)
			}) as unknown as typeof ndkActions.fetchEventsWithTimeout

			const catalog = await fetchProductCatalogByPubkey(VALID_PUBKEY, 500)

			expect(catalog.items).toHaveLength(499)
			expect(catalog.possiblyIncomplete).toBe(true)
		} finally {
			;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
			;(ndkActions as { fetchEventsWithTimeout: unknown }).fetchEventsWithTimeout = realFetchEventsWithTimeout
		}
	})
})

describe('safeNpubEncode', () => {
	test('returns null for empty input', () => {
		expect(safeNpubEncode('')).toBeNull()
	})

	test('returns null for whitespace input', () => {
		expect(safeNpubEncode('   ')).toBeNull()
	})

	test('returns null for truncated hex', () => {
		expect(safeNpubEncode('abc123')).toBeNull()
	})

	test('returns null for non-hex string', () => {
		expect(safeNpubEncode('not-a-valid-pubkey')).toBeNull()
	})

	test('returns npub string for valid 64-char hex pubkey', () => {
		const result = safeNpubEncode(VALID_PUBKEY)

		expect(result).not.toBeNull()
		expect(result!.startsWith('npub1')).toBe(true)
	})
})
