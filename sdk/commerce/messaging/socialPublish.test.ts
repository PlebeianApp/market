import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../../core/testing/publishContext'
import {
	publishCommentWorkflow,
	publishLiveChatMessageWorkflow,
	publishReactionDeletionWorkflow,
	publishReactionWorkflow,
} from './socialPublish'

const product = { id: 'p1', kind: 30402, pubkey: 'seller', created_at: 1, content: '', tags: [['d', 'mug']] }
const note = { id: 'n1', kind: 1, pubkey: 'alice', created_at: 1, content: 'hi', tags: [] }

describe('social publish workflows', () => {
	test('reactions address addressable targets by coordinate and others by id', async () => {
		const { context, published } = createTestPublishContext('me')
		await publishReactionWorkflow(context, { content: '+', targetEvent: product })
		await publishReactionWorkflow(context, { content: '❤️', targetEvent: note })
		expect(published[0].tags).toEqual([
			['a', '30402:seller:mug'],
			['p', 'seller'],
			['k', '30402'],
		])
		expect(published[1].tags).toEqual([
			['e', 'n1'],
			['p', 'alice'],
			['k', '1'],
		])
	})

	test('reaction deletion references the reaction event', async () => {
		const { context, published } = createTestPublishContext('me')
		await publishReactionDeletionWorkflow(context, { reactionId: 'r1', reactionAuthorPubkey: 'me', emoji: '+' })
		expect(published[0]).toMatchObject({
			kind: 5,
			content: 'Removed reaction: +',
			tags: [
				['e', 'r1'],
				['p', 'me'],
				['k', '7'],
			],
		})
	})

	test('comments and live chat use the context clock', async () => {
		const { context, published } = createTestPublishContext('me')
		await publishCommentWorkflow(context, { content: 'nice', targetEvent: product })
		await publishLiveChatMessageWorkflow(context, { liveActivityCoord: '30311:host:live', content: 'gm', relayHint: 'wss://r' })
		expect(published.map((event) => [event.kind, event.created_at])).toEqual([
			[1111, 1_700_000_000],
			[1311, 1_700_000_000],
		])
		expect(published[1].tags).toEqual([['a', '30311:host:live', 'wss://r', 'root']])
	})
})
