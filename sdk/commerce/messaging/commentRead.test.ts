import { describe, expect, test } from 'bun:test'
import {
	buildCommentFilters,
	buildCommentThreads,
	commentTargetsEvent,
	getCommentTargetKey,
	MAX_COMMENT_THREAD_DEPTH,
	mergeCommentEvents,
	parseComment,
	type CommentRecord,
} from './commentRead'

const PK = 'a'.repeat(64)
const product = { id: 'product-id', pubkey: PK, kind: 30402, content: '', tags: [['d', 'shirt']], created_at: 1 }
const note = { id: 'note-id', pubkey: PK, kind: 1, content: 'hi', tags: [], created_at: 1 }
const PRODUCT_ADDRESS = `30402:${PK}:shirt`

const comment = (id: string, tags: string[][], created_at?: number) => ({
	id,
	pubkey: 'b'.repeat(64),
	kind: 1111,
	content: id,
	tags,
	created_at,
})

describe('buildCommentFilters', () => {
	test('addressable target uses a/A/E filters and a fallback scan', () => {
		expect(buildCommentFilters(product)).toEqual({
			filters: [{ kinds: [1111], '#a': [PRODUCT_ADDRESS] }],
			replyFilters: [
				{ kinds: [1111], '#A': [PRODUCT_ADDRESS] },
				{ kinds: [1111], '#E': ['product-id'] },
			],
			fallbackFilters: [{ kinds: [1111], limit: 200 }],
		})
	})

	test('regular target uses e/E filters without fallback', () => {
		expect(buildCommentFilters(note)).toEqual({
			filters: [{ kinds: [1111], '#e': ['note-id'] }],
			replyFilters: [{ kinds: [1111], '#E': ['note-id'] }],
			fallbackFilters: null,
		})
	})

	test('target key is the address or the id', () => {
		expect(getCommentTargetKey(product)).toBe(PRODUCT_ADDRESS)
		expect(getCommentTargetKey(note)).toBe('note-id')
	})
})

describe('parseComment', () => {
	test('reads parent id only when parent kind is a comment', () => {
		const reply = parseComment(
			comment(
				'c2',
				[
					['k', '1111'],
					['e', 'c1'],
				],
				5,
			),
			product,
		)
		expect(reply).toMatchObject({
			id: 'c2',
			parentId: 'c1',
			createdAt: 5,
			targetEventId: 'product-id',
			targetEventPubkey: PK,
			targetEventKind: 30402,
			targetEventCoordinates: PRODUCT_ADDRESS,
		})

		const topLevel = parseComment(
			comment(
				'c3',
				[
					['k', '30402'],
					['e', 'x'],
				],
				5,
			),
			product,
		)
		expect(topLevel.parentId).toBeUndefined()
	})

	test('regular targets have no coordinates; missing created_at falls back to now', () => {
		const before = Math.floor(Date.now() / 1000)
		const parsed = parseComment(comment('c', []), note)
		expect(parsed.targetEventCoordinates).toBeUndefined()
		expect(parsed.createdAt).toBeGreaterThanOrEqual(before)
	})
})

describe('commentTargetsEvent / mergeCommentEvents', () => {
	test('matches E by id and A/a by address only for addressable targets', () => {
		expect(commentTargetsEvent(comment('x', [['E', 'product-id']]), product)).toBe(true)
		expect(commentTargetsEvent(comment('x', [['a', PRODUCT_ADDRESS]]), product)).toBe(true)
		expect(commentTargetsEvent(comment('x', [['A', PRODUCT_ADDRESS]]), note)).toBe(false)
		expect(commentTargetsEvent(comment('x', [['e', 'product-id']]), product)).toBe(false)
	})

	test('dedupes by id, later sources win, unrelated fallback events dropped', () => {
		const first = comment('c1', [], 1)
		const dup = { ...comment('c1', [], 1), content: 'updated' }
		const fallbackHit = comment('c2', [['A', PRODUCT_ADDRESS]], 2)
		const fallbackMiss = comment('c3', [['A', 'other']], 3)

		const merged = mergeCommentEvents(product, [first], [dup], [fallbackHit, fallbackMiss])
		expect(merged.map((c) => [c.id, c.content])).toEqual([
			['c1', 'updated'],
			['c2', 'c2'],
		])
	})
})

describe('buildCommentThreads', () => {
	const record = (id: string, createdAt: number, parentId?: string): CommentRecord => ({
		id,
		authorPubkey: PK,
		content: id,
		createdAt,
		event: note,
		targetEventId: 'note-id',
		targetEventPubkey: PK,
		targetEventKind: 1,
		parentId,
	})

	test('nests replies, sorts oldest-first, keeps orphans and self-parents top-level', () => {
		const threads = buildCommentThreads([
			record('b', 2),
			record('a', 1),
			record('r2', 5, 'a'),
			record('r1', 4, 'a'),
			record('orphan', 3, 'missing'),
			record('self', 0, 'self'),
		])

		expect(threads.map((t) => t.id)).toEqual(['self', 'a', 'b', 'orphan'])
		const a = threads[1]!
		expect(a.children.map((c) => c.id)).toEqual(['r1', 'r2'])
		expect(a.children[0]!.parentComment?.id).toBe('a')
	})

	test('truncates children beyond the max depth', () => {
		const chain = [record('c0', 0)]
		for (let i = 1; i <= MAX_COMMENT_THREAD_DEPTH + 2; i++) chain.push(record(`c${i}`, i, `c${i - 1}`))

		let node = buildCommentThreads(chain.reverse())[0]!
		let depth = 0
		while (node.children.length > 0) {
			node = node.children[0]!
			depth++
		}
		expect(depth).toBe(MAX_COMMENT_THREAD_DEPTH)
	})

	// Current behavior: a reply listed after its (already nested) parent stays top-level.
	test('nesting of grandchildren depends on input order', () => {
		const threads = buildCommentThreads([record('root', 0), record('child', 1, 'root'), record('grandchild', 2, 'child')])
		expect(threads.map((t) => t.id)).toEqual(['root', 'grandchild'])
	})
})
