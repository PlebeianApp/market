import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { MAX_COMMENT_LENGTH } from '@/lib/schemas/productComment'
import { ndkActions } from '@/lib/stores/ndk'
import { createProductCommentEvent, publishProductComment } from '@/publish/productComments'

const productCoords = `30402:${'a'.repeat(64)}:product-1`
const merchantPubkey = 'b'.repeat(64)

describe('product comment publishing', () => {
	const originalGetNdk = ndkActions.getNDK
	const originalGetSigner = ndkActions.getSigner
	const originalPublishEvent = ndkActions.publishEvent
	const originalSign = NDKEvent.prototype.sign

	beforeEach(() => {
		ndkActions.getNDK = mock(() => ({}) as any)
		ndkActions.getSigner = mock(() => ({ user: async () => ({ pubkey: 'c'.repeat(64) }) }) as any)
		ndkActions.publishEvent = mock(async () => new Set()) as any
		NDKEvent.prototype.sign = mock(async function (this: NDKEvent) {
			this.id = 'published-comment-id'
			return 'sig'
		}) as any
	})

	afterEach(() => {
		ndkActions.getNDK = originalGetNdk
		ndkActions.getSigner = originalGetSigner
		ndkActions.publishEvent = originalPublishEvent
		NDKEvent.prototype.sign = originalSign
	})

	test('builds the exact six v1 structural tags', () => {
		const event = createProductCommentEvent(productCoords, merchantPubkey, 'Hello world', {} as any)

		expect(event.kind).toBe(1111)
		expect(event.content).toBe('Hello world')
		expect(event.tags).toEqual([
			['A', productCoords],
			['K', '30402'],
			['P', merchantPubkey],
			['a', productCoords],
			['k', '30402'],
			['p', merchantPubkey],
		])
	})

	test('rejects empty and overlong comments before publish', async () => {
		await expect(publishProductComment(productCoords, merchantPubkey, '   ')).rejects.toThrow('Comment cannot be empty')
		await expect(publishProductComment(productCoords, merchantPubkey, 'x'.repeat(MAX_COMMENT_LENGTH + 1))).rejects.toThrow(
			`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`,
		)
	})

	test('signs and publishes through ndkActions.publishEvent', async () => {
		const commentId = await publishProductComment(productCoords, merchantPubkey, '  Valid comment  ')

		expect(commentId).toBe('published-comment-id')
		expect(ndkActions.publishEvent).toHaveBeenCalledTimes(1)
		const publishedEvent = (ndkActions.publishEvent as any).mock.calls[0][0]
		expect(publishedEvent.content).toBe('Valid comment')
		expect(publishedEvent.tags).toHaveLength(6)
	})
})
