import { afterEach, describe, expect, test } from 'bun:test'
import { naddrFromAddress } from '@/lib/nostr/naddr'
import { ndkActions } from '@/lib/stores/ndk'
import { getShippingEvent } from '../shipping'

type ShippingEvent = NonNullable<Awaited<ReturnType<typeof getShippingEvent>>>

const SELLER_PUBKEY = 'a'.repeat(64)
const SHIPPING_D_TAG = 'worldwide-standard'
const SHIPPING_REFERENCE = `30406:${SELLER_PUBKEY}:${SHIPPING_D_TAG}`
const realGetNDK = ndkActions.getNDK

afterEach(() => {
	;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
})

describe('getShippingEvent', () => {
	test('resolves an addressable cart shipping reference by its coordinate', async () => {
		const shippingEvent = {
			kind: 30406,
			pubkey: SELLER_PUBKEY,
			content: '',
			tags: [
				['d', SHIPPING_D_TAG],
				['service', 'standard'],
			],
			id: '0'.repeat(64),
			created_at: Math.floor(Date.now() / 1000),
			// `sig` is required by NostrEvent, but we use a cast for test mocking.
			sig: '0'.repeat(128),
		} as unknown as ShippingEvent
		let fetchedReference: string | undefined
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => ({
			fetchEvent: async (reference: string) => {
				fetchedReference = reference
				return shippingEvent
			},
		})

		await expect(getShippingEvent(SHIPPING_REFERENCE)).resolves.toBe(shippingEvent)
		expect(fetchedReference).toBe(naddrFromAddress(30406, SELLER_PUBKEY, SHIPPING_D_TAG))
	})
})
