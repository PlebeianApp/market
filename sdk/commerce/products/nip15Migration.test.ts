import { describe, expect, test } from 'bun:test'
import { parseNip15Product } from './nip15Migration'

describe('parseNip15Product', () => {
	test('reads the NIP-15 JSON content', () => {
		const product = parseNip15Product({
			content: JSON.stringify({
				id: 'p1',
				name: 'Mug',
				description: 'Ceramic',
				price: 21,
				currency: 'SAT',
				quantity: 3,
				images: ['a.jpg'],
				specs: [['Color', 'Blue']],
			}),
			tags: [],
		})
		expect(product).toMatchObject({
			id: 'p1',
			name: 'Mug',
			price: '21',
			currency: 'SAT',
			quantity: 3,
			images: ['a.jpg'],
			specs: [['Color', 'Blue']],
		})
	})

	test('falls back to the d tag and raw content for malformed JSON', () => {
		const product = parseNip15Product({ content: 'not json', tags: [['d', 'legacy']] })
		expect(product).toMatchObject({ id: 'legacy', description: 'not json', price: '0', currency: 'USD', quantity: null })
	})
})
