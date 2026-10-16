import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../../core/testing/publishContext'
import { publishShareNoteWorkflow } from './shareNote'

describe('publishShareNoteWorkflow', () => {
	test('publishes a kind-1 note tagged with the coordinate, url and hashtag', async () => {
		const { context, published } = createTestPublishContext('me')
		await publishShareNoteWorkflow(context, {
			content: 'Check this out',
			coordinate: '30402:seller:mug',
			url: 'https://market.example/products/mug',
		})
		expect(published[0]).toMatchObject({
			kind: 1,
			content: 'Check this out',
			tags: [
				['a', '30402:seller:mug'],
				['r', 'https://market.example/products/mug'],
				['t', 'plebeian'],
			],
		})
	})
})
