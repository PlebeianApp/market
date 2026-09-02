import { beforeEach, describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	A_TAG,
	E_TAG,
	K_TAG,
	L_TAG,
	LABEL_DELETION_KIND,
	LABEL_EVENT_KIND,
	LABEL_NAMESPACE,
	LABEL_VALUE_TEST,
	TEST_LABEL_PRODUCT_KIND,
	l_TAG,
} from '@/lib/constants/testLabels'
import { testLabelActions, testLabelStore } from '@/lib/stores/testLabels'
import {
	excludeTestLabeledEvents,
	getAuthorizedLabelerPubkeys,
	isLabelDeletionForLabel,
	isValidAuthorizedTestLabel,
	reconcileActiveTestLabels,
} from '../testLabels'

// --- Test fixtures ---

const ADMIN_PUBKEY = 'a'.repeat(64)
const OTHER_ADMIN_PUBKEY = '1'.repeat(64)
const UNAUTHORIZED_PUBKEY = 'b'.repeat(64)
const MERCHANT_PUBKEY = 'c'.repeat(64)

const PRODUCT_COORD = `30402:${MERCHANT_PUBKEY}:my-product`
const AUCTION_COORD = `30408:${MERCHANT_PUBKEY}:my-auction`

const makeFakeEvent = (params: { kind?: number; id?: string; pubkey?: string; created_at?: number; tags: string[][] }): NDKEvent =>
	({
		kind: params.kind ?? LABEL_EVENT_KIND,
		id: params.id ?? 'label-event-id-' + Math.random().toString(36).slice(2, 8),
		pubkey: params.pubkey ?? ADMIN_PUBKEY,
		created_at: params.created_at ?? 1724178700,
		tags: params.tags,
		content: '',
	}) as unknown as NDKEvent

const makeTestLabelEvent = (params: {
	coordinate?: string
	id?: string
	pubkey?: string
	created_at?: number
	namespace?: string
	value?: string
	includePTag?: boolean
	kind?: number
}): NDKEvent => {
	const coordinate = params.coordinate ?? PRODUCT_COORD
	const tags: string[][] = [
		[L_TAG, params.namespace ?? LABEL_NAMESPACE],
		[l_TAG, params.value ?? LABEL_VALUE_TEST, params.namespace ?? LABEL_NAMESPACE],
		[A_TAG, coordinate],
	]
	if (params.includePTag) tags.push(['p', MERCHANT_PUBKEY])
	return makeFakeEvent({ kind: params.kind, id: params.id, pubkey: params.pubkey, created_at: params.created_at, tags })
}

const makeTestLabelDeletionEvent = (params: { labelId: string; pubkey?: string; kind?: number; kTag?: string | null }): NDKEvent => {
	const tags: string[][] = [['e', params.labelId]]
	if (params.kTag !== null) tags.push(['k', params.kTag ?? String(LABEL_EVENT_KIND)])
	return makeFakeEvent({ kind: params.kind ?? LABEL_DELETION_KIND, pubkey: params.pubkey, tags })
}

// --- Store actions ---

describe('testLabelStore', () => {
	beforeEach(() => {
		testLabelActions.clearLabels()
	})

	test('setLabel marks a coordinate as test-labeled and tracks the label event', () => {
		expect(testLabelActions.isTestLabeled(PRODUCT_COORD)).toBe(false)

		testLabelActions.setLabel(PRODUCT_COORD, 'label-1', ADMIN_PUBKEY)

		expect(testLabelActions.isTestLabeled(PRODUCT_COORD)).toBe(true)
		expect(testLabelActions.getLabelEventId(PRODUCT_COORD)).toBe('label-1')
		expect(testLabelActions.getLabelerPubkey(PRODUCT_COORD)).toBe(ADMIN_PUBKEY)
		expect(testLabelActions.getTestLabeledCoordinates()).toEqual([PRODUCT_COORD])
	})

	test('removeLabel un-labels a coordinate (deletion seen)', () => {
		testLabelActions.setLabel(PRODUCT_COORD, 'label-1', ADMIN_PUBKEY)

		testLabelActions.removeLabel(PRODUCT_COORD)

		expect(testLabelActions.isTestLabeled(PRODUCT_COORD)).toBe(false)
		expect(testLabelActions.getLabelEventId(PRODUCT_COORD)).toBeUndefined()
		expect(testLabelActions.getLabelerPubkey(PRODUCT_COORD)).toBeUndefined()
		expect(testLabelActions.getTestLabeledCoordinates()).toEqual([])
	})

	test('removeLabel is a no-op for unknown coordinates', () => {
		const before = testLabelStore.state.lastUpdated
		testLabelActions.removeLabel(`30402:${MERCHANT_PUBKEY}:never-labeled`)
		expect(testLabelStore.state.lastUpdated).toBe(before)
	})

	test('isTestLabeled is false for empty input', () => {
		testLabelActions.setLabel(PRODUCT_COORD, 'label-1', ADMIN_PUBKEY)
		expect(testLabelActions.isTestLabeled('')).toBe(false)
	})

	test('applyFetchedLabels marks fetched coordinates with active labels', () => {
		const labels = new Map([[PRODUCT_COORD, { eventId: 'label-1', labelerPubkey: ADMIN_PUBKEY }]])

		testLabelActions.applyFetchedLabels(labels, [PRODUCT_COORD])

		expect(testLabelActions.isTestLabeled(PRODUCT_COORD)).toBe(true)
		expect(testLabelActions.getLabelEventId(PRODUCT_COORD)).toBe('label-1')
		expect(testLabelActions.areLabelsLoaded()).toBe(true)
	})

	test('applyFetchedLabels clears coordinates whose label is absent (deletion reconciled)', () => {
		testLabelActions.setLabel(PRODUCT_COORD, 'label-1', ADMIN_PUBKEY)

		// Relay says the label is gone for this coordinate
		testLabelActions.applyFetchedLabels(new Map(), [PRODUCT_COORD])

		expect(testLabelActions.isTestLabeled(PRODUCT_COORD)).toBe(false)
		expect(testLabelActions.areLabelsLoaded()).toBe(true)
	})

	test('applyFetchedLabels leaves coordinates outside the fetched batch untouched', () => {
		testLabelActions.setLabel(PRODUCT_COORD, 'label-1', ADMIN_PUBKEY)

		// A fetch for a different coordinate must not clear PRODUCT_COORD
		const otherCoord = `30402:${MERCHANT_PUBKEY}:other-product`
		testLabelActions.applyFetchedLabels(new Map(), [otherCoord])

		expect(testLabelActions.isTestLabeled(PRODUCT_COORD)).toBe(true)
		expect(testLabelActions.isTestLabeled(otherCoord)).toBe(false)
	})

	test('applyFetchedLabels deduplicates and skips empty coordinates', () => {
		const labels = new Map([[PRODUCT_COORD, { eventId: 'label-1', labelerPubkey: ADMIN_PUBKEY }]])

		testLabelActions.applyFetchedLabels(labels, [PRODUCT_COORD, PRODUCT_COORD, ''])

		expect(testLabelActions.isTestLabeled(PRODUCT_COORD)).toBe(true)
		expect(testLabelActions.getTestLabeledCoordinates()).toEqual([PRODUCT_COORD])
	})

	test('clearLabels resets all state', () => {
		testLabelActions.setLabel(PRODUCT_COORD, 'label-1', ADMIN_PUBKEY)

		testLabelActions.clearLabels()

		expect(testLabelActions.getTestLabeledCoordinates()).toEqual([])
		expect(testLabelActions.areLabelsLoaded()).toBe(false)
	})
})

// --- Label event validation ---

describe('isValidAuthorizedTestLabel', () => {
	test('accepts a well-formed label from an authorized labeler', () => {
		const event = makeTestLabelEvent({ coordinate: PRODUCT_COORD })
		expect(isValidAuthorizedTestLabel(event, [ADMIN_PUBKEY])).toBe(true)
	})

	test('rejects labels from unauthorized pubkeys', () => {
		const event = makeTestLabelEvent({ coordinate: PRODUCT_COORD, pubkey: UNAUTHORIZED_PUBKEY })
		expect(isValidAuthorizedTestLabel(event, [ADMIN_PUBKEY])).toBe(false)
	})

	test('rejects labels in a foreign namespace', () => {
		const event = makeTestLabelEvent({ coordinate: PRODUCT_COORD, namespace: 'com.other.app' })
		expect(isValidAuthorizedTestLabel(event, [ADMIN_PUBKEY])).toBe(false)
	})

	test('rejects label values other than "test"', () => {
		const event = makeTestLabelEvent({ coordinate: PRODUCT_COORD, value: 'spam' })
		expect(isValidAuthorizedTestLabel(event, [ADMIN_PUBKEY])).toBe(false)
	})

	test('rejects l tags without the namespace as third element', () => {
		const event = makeFakeEvent({
			tags: [
				[LABEL_NAMESPACE, LABEL_NAMESPACE],
				[l_TAG, LABEL_VALUE_TEST],
				[A_TAG, PRODUCT_COORD],
			],
		})
		expect(isValidAuthorizedTestLabel(event, [ADMIN_PUBKEY])).toBe(false)
	})

	test('rejects events without an a-tag target', () => {
		const event = makeFakeEvent({
			tags: [
				['L', LABEL_NAMESPACE],
				[l_TAG, LABEL_VALUE_TEST, LABEL_NAMESPACE],
			],
		})
		expect(isValidAuthorizedTestLabel(event, [ADMIN_PUBKEY])).toBe(false)
	})

	test('rejects non-1985 kinds', () => {
		const event = makeTestLabelEvent({ coordinate: PRODUCT_COORD, kind: 30402 })
		expect(isValidAuthorizedTestLabel(event, [ADMIN_PUBKEY])).toBe(false)
	})
})

// --- NIP-09 deletion validation ---

describe('isLabelDeletionForLabel', () => {
	const label = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-1', pubkey: ADMIN_PUBKEY })

	test('accepts a deletion signed by the same labeler with a matching e tag and k tag', () => {
		const deletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: ADMIN_PUBKEY })
		expect(isLabelDeletionForLabel(deletion, label)).toBe(true)
	})

	test('accepts a deletion without a k tag (k is a NIP-09 SHOULD, not MUST)', () => {
		const deletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: ADMIN_PUBKEY, kTag: null })
		expect(isLabelDeletionForLabel(deletion, label)).toBe(true)
	})

	test('rejects a deletion signed by a different pubkey than the label event (NIP-09 MUST)', () => {
		const deletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: OTHER_ADMIN_PUBKEY })
		expect(isLabelDeletionForLabel(deletion, label)).toBe(false)
	})

	test('rejects a deletion that does not reference the label event id', () => {
		const deletion = makeTestLabelDeletionEvent({ labelId: 'some-other-event', pubkey: ADMIN_PUBKEY })
		expect(isLabelDeletionForLabel(deletion, label)).toBe(false)
	})

	test('rejects a deletion whose k tag declares a different kind', () => {
		const deletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: ADMIN_PUBKEY, kTag: '30402' })
		expect(isLabelDeletionForLabel(deletion, label)).toBe(false)
	})

	test('rejects non-kind-5 events', () => {
		const deletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: ADMIN_PUBKEY, kind: 1985 })
		expect(isLabelDeletionForLabel(deletion, label)).toBe(false)
	})
})

// --- Reconciliation ---

describe('reconcileActiveTestLabels', () => {
	test('returns label metadata for an active label', () => {
		const label = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-1' })

		const active = reconcileActiveTestLabels([label], [])

		expect(active.get(PRODUCT_COORD)).toEqual({ eventId: 'label-1', labelerPubkey: ADMIN_PUBKEY })
	})

	test('treats a label with a matching NIP-09 deletion as absent', () => {
		const label = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-1' })
		const deletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: ADMIN_PUBKEY })

		const active = reconcileActiveTestLabels([label], [deletion])

		expect(active.has(PRODUCT_COORD)).toBe(false)
	})

	test('coordinate stays labeled when another active label remains after one is deleted', () => {
		const older = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-1', created_at: 1000 })
		const newer = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-2', created_at: 2000 })
		const deletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: ADMIN_PUBKEY })

		const active = reconcileActiveTestLabels([older, newer], [deletion])

		expect(active.get(PRODUCT_COORD)).toEqual({ eventId: 'label-2', labelerPubkey: ADMIN_PUBKEY })
	})

	test('newest active label wins when several exist for one coordinate', () => {
		const older = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-1', created_at: 1000 })
		const newer = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-2', created_at: 2000, pubkey: OTHER_ADMIN_PUBKEY })

		const active = reconcileActiveTestLabels([older, newer], [])

		expect(active.get(PRODUCT_COORD)).toEqual({ eventId: 'label-2', labelerPubkey: OTHER_ADMIN_PUBKEY })
	})

	test('handles labels targeting multiple coordinates via multiple a tags', () => {
		const label = makeFakeEvent({
			id: 'label-1',
			tags: [
				['L', LABEL_NAMESPACE],
				[l_TAG, LABEL_VALUE_TEST, LABEL_NAMESPACE],
				[A_TAG, PRODUCT_COORD],
				[A_TAG, AUCTION_COORD],
			],
		})

		const active = reconcileActiveTestLabels([label], [])

		expect(active.has(PRODUCT_COORD)).toBe(true)
		expect(active.has(AUCTION_COORD)).toBe(true)
	})

	test('requestedCoordinates restricts the returned coordinates', () => {
		const label = makeFakeEvent({
			id: 'label-1',
			tags: [
				['L', LABEL_NAMESPACE],
				[l_TAG, LABEL_VALUE_TEST, LABEL_NAMESPACE],
				[A_TAG, PRODUCT_COORD],
				[A_TAG, AUCTION_COORD],
			],
		})

		const active = reconcileActiveTestLabels([label], [], [PRODUCT_COORD])

		expect(active.has(PRODUCT_COORD)).toBe(true)
		expect(active.has(AUCTION_COORD)).toBe(false)
	})

	test('deletion from a different labeler does not remove another labeler\u2019s label', () => {
		// label-1 by ADMIN, label-2 by OTHER_ADMIN, deletion of label-1 signed by OTHER_ADMIN (invalid)
		const label1 = makeTestLabelEvent({ coordinate: PRODUCT_COORD, id: 'label-1', pubkey: ADMIN_PUBKEY, created_at: 1000 })
		const invalidDeletion = makeTestLabelDeletionEvent({ labelId: 'label-1', pubkey: OTHER_ADMIN_PUBKEY })

		const active = reconcileActiveTestLabels([label1], [invalidDeletion])

		// The invalid deletion must not remove the label
		expect(active.get(PRODUCT_COORD)).toEqual({ eventId: 'label-1', labelerPubkey: ADMIN_PUBKEY })
	})
})

// --- Fail-open behavior ---

describe('getAuthorizedLabelerPubkeys', () => {
	test('returns null when admin settings are unavailable (no NDK in unit-test runtime)', async () => {
		// In the unit-test runtime no NDK instance exists, so fetchAdminSettings
		// throws and the authorized set must be reported as unavailable (null),
		// never as an empty authorized set.
		const result = await getAuthorizedLabelerPubkeys()
		expect(result).toBeNull()
	})
})

describe('fetchTestLabels fail-open (via store)', () => {
	test('store stays not-loaded when authorization data is unavailable, so filters fail open', async () => {
		testLabelActions.clearLabels()

		// fetchTestLabels with no NDK available must leave the store unloaded
		const { fetchTestLabels } = await import('../testLabels')
		const result = await fetchTestLabels([PRODUCT_COORD])

		expect(result.size).toBe(0)
		expect(testLabelActions.areLabelsLoaded()).toBe(false)
	})
})

// --- Show-test-listings toggle (ADR-0009 rev 3) ---

describe('excludeTestLabeledEvents toggle', () => {
	const makeProductEvent = (dTag: string): NDKEvent =>
		({
			kind: TEST_LABEL_PRODUCT_KIND,
			pubkey: MERCHANT_PUBKEY,
			id: `product-${dTag}`,
			created_at: 1724178700,
			tags: [['d', dTag]],
			content: '',
			tagValue: (name: string) => (name === 'd' ? dTag : undefined),
		}) as unknown as NDKEvent

	test('returns events unfiltered when showTestListings is true', async () => {
		testLabelActions.clearLabels()
		testLabelActions.setShowTestListings(true)

		// No store population needed: the short-circuit returns before any fetch.
		const result = await excludeTestLabeledEvents([makeProductEvent('my-product')])

		expect(result).toHaveLength(1)
	})

	test('still filters labeled events when showTestListings is false', async () => {
		testLabelActions.clearLabels()
		// Load the store so filtering is active, with PRODUCT_COORD labeled.
		testLabelActions.applyFetchedLabels(new Map([[PRODUCT_COORD, { eventId: 'label-1', labelerPubkey: ADMIN_PUBKEY }]]), [PRODUCT_COORD])
		testLabelActions.setShowTestListings(false)

		const result = await excludeTestLabeledEvents([makeProductEvent('my-product')])

		expect(result).toHaveLength(0)
	})
})
