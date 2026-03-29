import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { ndkActions } from '@/lib/stores/ndk'
import { blacklistActions } from '@/lib/stores/blacklist'
import { fetchProductComments } from '@/queries/productComments'

const productCoords = `30402:${'a'.repeat(64)}:product-1`
const merchantPubkey = 'b'.repeat(64)

const validEvent = {
	id: 'event-1',
	kind: 1111,
	content: 'Newest valid comment',
	pubkey: 'c'.repeat(64),
	created_at: 200,
	tags: [
		['A', productCoords],
		['K', '30402'],
		['P', merchantPubkey],
		['a', productCoords],
		['k', '30402'],
		['p', merchantPubkey],
	],
}

describe('fetchProductComments', () => {
	const originalGetNdk = ndkActions.getNDK
	const originalFetchEventsWithTimeout = ndkActions.fetchEventsWithTimeout
	const originalIsBlacklistLoaded = blacklistActions.isBlacklistLoaded
	const originalIsPubkeyBlacklisted = blacklistActions.isPubkeyBlacklisted

	beforeEach(() => {
		ndkActions.getNDK = mock(() => ({}) as any)
		blacklistActions.isBlacklistLoaded = mock(() => true)
		blacklistActions.isPubkeyBlacklisted = mock((pubkey: string) => pubkey === 'd'.repeat(64))
	})

	afterEach(() => {
		ndkActions.getNDK = originalGetNdk
		ndkActions.fetchEventsWithTimeout = originalFetchEventsWithTimeout
		blacklistActions.isBlacklistLoaded = originalIsBlacklistLoaded
		blacklistActions.isPubkeyBlacklisted = originalIsPubkeyBlacklisted
	})

	test('filters invalid comments, blacklisted authors, dedupes by id, and sorts newest first', async () => {
		ndkActions.fetchEventsWithTimeout = mock(
			async () =>
				new Set([
					validEvent,
					{ ...validEvent, id: 'event-1', created_at: 150, content: 'Older duplicate' },
					{ ...validEvent, id: 'event-2', created_at: 175, content: 'Second valid comment' },
					{ ...validEvent, id: 'event-3', pubkey: 'd'.repeat(64), content: 'Blocked author' },
					{ ...validEvent, id: 'event-4', tags: [['a', productCoords]] },
				] as any[]),
		) as any

		const result = await fetchProductComments(productCoords, merchantPubkey)

		expect(result.map((event) => event.id)).toEqual(['event-1', 'event-2'])
		expect(result[0]?.content).toBe('Newest valid comment')
	})

	test('returns an empty array when ndk is unavailable', async () => {
		ndkActions.getNDK = mock(() => null as any)

		await expect(fetchProductComments(productCoords, merchantPubkey)).resolves.toEqual([])
	})
})
