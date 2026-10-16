import { describe, expect, test } from 'bun:test'
import { createCommentTemplate } from './commentEvents'

const product = { id: 'product-event-id', kind: 30402, pubkey: 'seller-pubkey', tags: [['d', 'my-product']], content: '' }
const regularPost = { id: 'post-event-id', kind: 1, pubkey: 'author-pubkey', tags: [], content: '' }

describe('createCommentTemplate', () => {
	test('top-level comment on an addressable target uses A/a tags', () => {
		const template = createCommentTemplate({ content: 'nice product', targetEvent: product, createdAt: 1700000000 })

		expect(template).toEqual({
			kind: 1111,
			created_at: 1700000000,
			content: 'nice product',
			tags: [
				['A', '30402:seller-pubkey:my-product'],
				['K', '30402'],
				['P', 'seller-pubkey'],
				['a', '30402:seller-pubkey:my-product'],
				['k', '30402'],
				['p', 'seller-pubkey'],
			],
		})
	})

	test('top-level comment on a regular target uses E/e tags', () => {
		const template = createCommentTemplate({ content: 'hello', targetEvent: regularPost, createdAt: 1700000000 })

		expect(template.tags).toEqual([
			['E', 'post-event-id'],
			['K', '1'],
			['P', 'author-pubkey'],
			['e', 'post-event-id'],
			['k', '1'],
			['p', 'author-pubkey'],
		])
	})

	test('reply roots the parent scope on the parent comment, not the thread target', () => {
		const template = createCommentTemplate({
			content: 'reply',
			targetEvent: product,
			parentComment: { id: 'parent-comment-id', authorPubkey: 'parent-author-pubkey' },
			createdAt: 1700000001,
		})

		expect(template.tags).toEqual([
			['A', '30402:seller-pubkey:my-product'],
			['K', '30402'],
			['P', 'seller-pubkey'],
			['e', 'parent-comment-id'],
			['k', '1111'],
			['p', 'parent-author-pubkey'],
		])
	})
})
