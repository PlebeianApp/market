import { describe, expect, test } from 'bun:test'
import { getUniqueAuctionShippingRefs, parseAuctionShippingRef } from '@/lib/auctionShippingRefs'

const sellerA = 'a'.repeat(64)
const sellerB = 'b'.repeat(64)

describe('auction shipping refs', () => {
	test('parses valid shipping coordinate refs', () => {
		expect(parseAuctionShippingRef(`30406:${sellerA}:standard`)).toEqual({
			shippingRef: `30406:${sellerA}:standard`,
			pubkey: sellerA,
			dTag: 'standard',
		})
	})

	test('marks malformed refs invalid', () => {
		const refs = getUniqueAuctionShippingRefs([
			{ shippingRef: 'shipping:standard', extraCost: '' },
			{ shippingRef: '30406:not-a-pubkey:standard', extraCost: '1' },
			{ shippingRef: `30406:${sellerA}:`, extraCost: '2' },
		])

		expect(refs).toEqual([
			{ shippingRef: 'shipping:standard', extraCost: '', status: 'invalid', pubkey: '', dTag: '' },
			{ shippingRef: '30406:not-a-pubkey:standard', extraCost: '1', status: 'invalid', pubkey: '', dTag: '' },
			{ shippingRef: `30406:${sellerA}:`, extraCost: '2', status: 'invalid', pubkey: '', dTag: '' },
		])
	})

	test('dedupes duplicate refs with first occurrence winning', () => {
		const refs = getUniqueAuctionShippingRefs([
			{ shippingRef: `30406:${sellerA}:standard`, extraCost: '5' },
			{ shippingRef: `30406:${sellerA}:standard`, extraCost: '10' },
			{ shippingRef: `30406:${sellerB}:pickup`, extraCost: '' },
		])

		expect(refs).toEqual([
			{ shippingRef: `30406:${sellerA}:standard`, extraCost: '5', status: 'valid', pubkey: sellerA, dTag: 'standard' },
			{ shippingRef: `30406:${sellerB}:pickup`, extraCost: '', status: 'valid', pubkey: sellerB, dTag: 'pickup' },
		])
	})
})
