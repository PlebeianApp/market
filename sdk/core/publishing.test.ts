import { describe, expect, test } from 'bun:test'
import { addressableCoordinate, deleteAddressableEvent, signAndPublish } from './publishing'
import { createTestPublishContext } from './testing/publishContext'

describe('core publishing wiring', () => {
	test('signs with the context clock and publishes once', async () => {
		const { context, published } = createTestPublishContext('me')
		const event = await signAndPublish(context, { kind: 1, content: 'hi', tags: [['t', 'x']] })
		expect(event).toMatchObject({ kind: 1, content: 'hi', created_at: 1_700_000_000, pubkey: 'me' })
		expect(published).toEqual([event])
	})

	test('does not report success when the publisher rejects', async () => {
		const { context } = createTestPublishContext()
		context.publish = async () => {
			throw new Error('rejected by relays')
		}
		await expect(signAndPublish(context, { kind: 1, content: '', tags: [] })).rejects.toThrow('rejected by relays')
	})

	test('deletes only the author coordinate and requires a d tag', async () => {
		const { context, published } = createTestPublishContext('me')
		await deleteAddressableEvent(context, 30402, 'mug', 'Product deleted')
		expect(published[0]).toMatchObject({ kind: 5, content: 'Product deleted', tags: [['a', addressableCoordinate(30402, 'me', 'mug')]] })
		await expect(deleteAddressableEvent(context, 30402, '', 'x')).rejects.toThrow('d tag is required')
	})
})
