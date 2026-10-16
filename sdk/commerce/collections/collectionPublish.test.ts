import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../../core/testing/publishContext'
import { deleteCollectionWorkflow, publishCollectionWorkflow } from './collectionPublish'

const input = {
	name: 'Mugs',
	summary: 'Ceramic',
	description: 'All the mugs',
	products: ['30402:seller:mug'],
	shippings: [],
}

describe('collection publish workflow', () => {
	test('publishes with a new id and returns the coordinate', async () => {
		const { context, published } = createTestPublishContext('seller')
		const outcome = await publishCollectionWorkflow({ ...context, createCollectionId: () => 'c1' }, input)
		expect(outcome.coordinate).toBe('30405:seller:c1')
		expect(published[0].kind).toBe(30405)
		expect(published[0].tags).toContainEqual(['a', '30402:seller:mug'])
	})

	test('updates reuse the existing id', async () => {
		const { context, published } = createTestPublishContext('seller')
		const outcome = await publishCollectionWorkflow({ ...context, createCollectionId: () => 'unused' }, input, 'c-old')
		expect(outcome.collectionId).toBe('c-old')
		expect(published[0].tags).toContainEqual(['d', 'c-old'])
	})

	test('delete targets the author collection coordinate', async () => {
		const { context, published } = createTestPublishContext('seller')
		await deleteCollectionWorkflow(context, 'c1')
		expect(published[0]).toMatchObject({ kind: 5, content: 'Collection deleted', tags: [['a', '30405:seller:c1']] })
	})
})
