import { describe, expect, test } from 'bun:test'
import {
	getCollectionCoordinates,
	getCollectionId,
	getCollectionImages,
	getCollectionShippingOptions,
	getCollectionSummary,
	getCollectionTitle,
} from './collectionReadModel'

describe('collection read model', () => {
	const event = {
		pubkey: 'a'.repeat(64),
		tags: [
			['d', 'summer'],
			['title', 'Summer collection'],
			['summary', 'Warm-weather picks'],
			['image', 'https://example.test/one.png'],
			['shipping_option', '30406:merchant:standard'],
		],
	}

	test('reads collection display data and addressable coordinate', () => {
		expect(getCollectionTitle(event)).toBe('Summer collection')
		expect(getCollectionSummary(event)).toBe('Warm-weather picks')
		expect(getCollectionId(event)).toBe('summer')
		expect(getCollectionCoordinates(event)).toBe(`30405:${event.pubkey}:summer`)
		expect(getCollectionImages(event)).toEqual([['image', 'https://example.test/one.png']])
		expect(getCollectionShippingOptions(event)).toEqual([['shipping_option', '30406:merchant:standard']])
	})

	test('preserves current fallbacks for missing collection fields', () => {
		expect(getCollectionTitle(null)).toBe('Untitled Collection')
		expect(getCollectionSummary(null)).toBe('No summary available.')
		expect(getCollectionImages(null)).toEqual([])
		expect(getCollectionShippingOptions(null)).toEqual([])
	})
})
