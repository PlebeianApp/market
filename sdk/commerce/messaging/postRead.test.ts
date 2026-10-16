import { describe, expect, test } from 'bun:test'
import { buildPostByIdFilter, buildRecentPostsFilter, parsePost, sortPostsNewestFirst } from './postRead'

describe('postRead', () => {
	test('filters', () => {
		expect(buildRecentPostsFilter()).toEqual({ kinds: [1], limit: 20 })
		expect(buildPostByIdFilter('abc')).toEqual({ ids: ['abc'] })
	})

	test('parsePost maps fields and falls back to now without created_at', () => {
		expect(parsePost({ id: 'p', pubkey: 'pk', kind: 1, content: 'hello', tags: [], created_at: 7 })).toEqual({
			id: 'p',
			content: 'hello',
			author: 'pk',
			createdAt: 7,
		})
		const before = Math.floor(Date.now() / 1000)
		expect(parsePost({ id: 'p', pubkey: 'pk', kind: 1, content: '', tags: [] }).createdAt).toBeGreaterThanOrEqual(before)
	})

	test('sortPostsNewestFirst', () => {
		const posts = [1, 3, 2].map((createdAt) => ({ id: String(createdAt), content: '', author: '', createdAt }))
		expect(sortPostsNewestFirst(posts).map((p) => p.id)).toEqual(['3', '2', '1'])
	})
})
