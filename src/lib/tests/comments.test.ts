import { expect, test, describe } from 'bun:test'
import {
	ProductCommentSchema,
	COMMENT_KIND,
	PRODUCT_KIND,
	getCommentAuthor,
	getCommentRootAddress,
	getCommentParentId,
	getCommentSubject,
} from '@/lib/schemas/productComment'

describe('ProductCommentSchema', () => {
	const validPubkey = 'a'.repeat(64)
	const validEventId = 'b'.repeat(64)
	const validAddress = `${PRODUCT_KIND}:${validPubkey}:my-product`

	test('parses valid top-level comment with required tags', () => {
		const event = {
			kind: COMMENT_KIND,
			created_at: 1234567890,
			tags: [
				['A', validAddress],
				['K', PRODUCT_KIND.toString()],
				['p', validPubkey],
			],
			content: 'This is a test comment',
		}
		const result = ProductCommentSchema.safeParse(event)
		expect(result.success).toBe(true)
	})

	test('parses valid reply comment with parent tags', () => {
		const event = {
			kind: COMMENT_KIND,
			created_at: 1234567890,
			tags: [
				['A', validAddress],
				['K', PRODUCT_KIND.toString()],
				['p', validPubkey],
				['e', validEventId],
				['k', COMMENT_KIND.toString()],
				['p', validPubkey],
			],
			content: 'This is a reply',
		}
		const result = ProductCommentSchema.safeParse(event)
		expect(result.success).toBe(true)
	})

	test('rejects comment missing K tag', () => {
		const event = {
			kind: COMMENT_KIND,
			created_at: 1234567890,
			tags: [
				['A', validAddress],
				['p', validPubkey],
			],
			content: 'Missing K tag',
		}
		const result = ProductCommentSchema.safeParse(event)
		expect(result.success).toBe(false)
	})

	test('rejects comment missing A/E/I root scope tag', () => {
		const event = {
			kind: COMMENT_KIND,
			created_at: 1234567890,
			tags: [
				['K', PRODUCT_KIND.toString()],
				['p', validPubkey],
			],
			content: 'Missing root scope tag',
		}
		const result = ProductCommentSchema.safeParse(event)
		expect(result.success).toBe(false)
	})

	test('rejects comment missing p tag', () => {
		const event = {
			kind: COMMENT_KIND,
			created_at: 1234567890,
			tags: [
				['A', validAddress],
				['K', PRODUCT_KIND.toString()],
			],
			content: 'Missing p tag',
		}
		const result = ProductCommentSchema.safeParse(event)
		expect(result.success).toBe(false)
	})
})

describe('getCommentAuthor', () => {
	test('extracts pubkey from lowercase p tag', () => {
		const event = {
			tags: [['p', 'lowercase123']],
		}
		expect(getCommentAuthor(event)).toBe('lowercase123')
	})

	test('returns first p tag value when multiple exist', () => {
		const event = {
			tags: [
				['p', 'first123'],
				['p', 'second456'],
			],
		}
		expect(getCommentAuthor(event)).toBe('first123')
	})

	test('returns undefined when no p tag', () => {
		const event = {
			tags: [],
		}
		expect(getCommentAuthor(event)).toBeUndefined()
	})
})

describe('getCommentRootAddress', () => {
	test('extracts A tag value', () => {
		const event = {
			tags: [['A', `${PRODUCT_KIND}:abc123:my-product`]],
		}
		expect(getCommentRootAddress(event)).toBe(`${PRODUCT_KIND}:abc123:my-product`)
	})

	test('returns undefined when no A tag', () => {
		const event = {
			tags: [],
		}
		expect(getCommentRootAddress(event)).toBeUndefined()
	})
})

describe('getCommentParentId', () => {
	const validEventId = 'b'.repeat(64)

	test('returns parent ID when e tag present with k=1111', () => {
		const event = {
			tags: [
				['e', validEventId],
				['k', '1111'],
			],
		}
		expect(getCommentParentId(event)).toBe(validEventId)
	})

	test('returns undefined for top-level comment (no k tag)', () => {
		const event = {
			tags: [['A', `${PRODUCT_KIND}:${'a'.repeat(64)}:my-product`]],
		}
		expect(getCommentParentId(event)).toBeUndefined()
	})

	test('returns undefined when e tag present but no k tag', () => {
		const event = {
			tags: [['e', validEventId]],
		}
		expect(getCommentParentId(event)).toBeUndefined()
	})
})

describe('getCommentSubject', () => {
	test('extracts subject tag value', () => {
		const event = {
			tags: [['subject', 'My Subject Line']],
		}
		expect(getCommentSubject(event)).toBe('My Subject Line')
	})

	test('returns undefined when no subject tag', () => {
		const event = {
			tags: [],
		}
		expect(getCommentSubject(event)).toBeUndefined()
	})
})

describe('NIP-22 Constants', () => {
	test('COMMENT_KIND is 1111', () => {
		expect(COMMENT_KIND).toBe(1111)
	})

	test('PRODUCT_KIND is 30402', () => {
		expect(PRODUCT_KIND).toBe(30402)
	})
})
