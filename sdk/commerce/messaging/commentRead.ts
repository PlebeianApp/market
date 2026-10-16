import { isAddressableKind } from 'nostr-tools/kinds'
import { getEventAddress, type NostrEventLike } from '../../core/nostr/eventLike'
import { COMMENT_KIND } from './commentEvents'

export const MAX_COMMENT_THREAD_DEPTH = 5

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type CommentFilter = {
	kinds: number[]
	'#a'?: string[]
	'#A'?: string[]
	'#e'?: string[]
	'#E'?: string[]
	limit?: number
}

export interface CommentFilterSet {
	/** Comments whose parent scope is the target. */
	filters: CommentFilter[]
	/** Comments rooted on the target (replies included). */
	replyFilters: CommentFilter[]
	/** Broad recent-comments scan for addressable targets; null for regular targets. */
	fallbackFilters: CommentFilter[] | null
}

export interface CommentRecord<E = NostrEventLike> {
	id: string
	authorPubkey: string
	content: string
	createdAt: number
	/** Reference to the same comment as an event */
	event: E
	/** Root of the comment thread, e.g. Product Listing */
	targetEventId: string
	targetEventPubkey: string
	targetEventKind: number
	targetEventCoordinates?: string
	/** Comment parent Id */
	parentId?: string
}

export interface CommentThreadRecord<E = NostrEventLike> extends CommentRecord<E> {
	parentComment?: CommentRecord<E>
	children: CommentThreadRecord<E>[]
}

/** Thread key for a comment target: its address when addressable, otherwise its id. */
export function getCommentTargetKey(target: NostrEventLike): string {
	return isAddressableKind(target.kind) ? getEventAddress(target) : target.id
}

export function buildCommentFilters(target: NostrEventLike): CommentFilterSet {
	if (isAddressableKind(target.kind)) {
		const address = getEventAddress(target)
		return {
			filters: [{ kinds: [COMMENT_KIND], '#a': [address] }],
			replyFilters: [
				{ kinds: [COMMENT_KIND], '#A': [address] },
				{ kinds: [COMMENT_KIND], '#E': [target.id] },
			],
			fallbackFilters: [{ kinds: [COMMENT_KIND], limit: 200 }],
		}
	}

	return {
		filters: [{ kinds: [COMMENT_KIND], '#e': [target.id] }],
		replyFilters: [{ kinds: [COMMENT_KIND], '#E': [target.id] }],
		fallbackFilters: null,
	}
}

export function parseComment<E extends NostrEventLike>(event: E, target: NostrEventLike): CommentRecord<E> {
	const parentKind = event.tags.find((t) => t[0] === 'k')?.at(1)
	const parentId = parentKind === COMMENT_KIND.toString() ? event.tags.find((t) => t[0] === 'e')?.at(1) : undefined
	const coordinates = isAddressableKind(target.kind) ? getEventAddress(target) : undefined

	return {
		id: event.id,
		content: event.content,
		authorPubkey: event.pubkey,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		event,
		targetEventId: target.id,
		targetEventPubkey: target.pubkey,
		targetEventKind: target.kind,
		targetEventCoordinates: coordinates,
		parentId,
	}
}

export function commentTargetsEvent(commentEvent: NostrEventLike, target: NostrEventLike): boolean {
	const targetAddress = isAddressableKind(target.kind) ? getEventAddress(target) : undefined

	return commentEvent.tags.some((tag) => {
		if (tag[0] === 'E') return tag[1] === target.id
		if (tag[0] === 'A' || tag[0] === 'a') return !!targetAddress && tag[1] === targetAddress
		return false
	})
}

/** Dedupe by id (later sources win); fallback events are kept only when they reference the target. */
export function mergeCommentEvents<E extends NostrEventLike>(
	target: NostrEventLike,
	events: Iterable<E>,
	replies: Iterable<E>,
	fallbackEvents: Iterable<E>,
): CommentRecord<E>[] {
	const commentsById = new Map<string, CommentRecord<E>>()

	for (const e of events) commentsById.set(e.id, parseComment(e, target))
	for (const e of replies) commentsById.set(e.id, parseComment(e, target))
	for (const e of fallbackEvents) {
		if (!commentTargetsEvent(e, target)) continue
		commentsById.set(e.id, parseComment(e, target))
	}

	return Array.from(commentsById.values())
}

function sortCommentThreadByDate<E>(thread: CommentThreadRecord<E>, depth = 0, visited = new Set<string>()): void {
	if (depth >= MAX_COMMENT_THREAD_DEPTH) {
		thread.children = []
		return
	}
	if (visited.has(thread.id)) {
		thread.children = []
		return
	}

	visited.add(thread.id)
	thread.children.sort((a, b) => a.createdAt - b.createdAt)
	thread.children.forEach((child) => sortCommentThreadByDate(child, depth + 1, new Set(visited)))
}

/** Nest replies under their parents, sort oldest-first at every level, and cut threads at MAX_COMMENT_THREAD_DEPTH. */
export function buildCommentThreads<E>(comments: CommentRecord<E>[]): CommentThreadRecord<E>[] {
	const mapCommentsById = new Map<string, CommentThreadRecord<E>>()
	comments.forEach((c) => mapCommentsById.set(c.id, { ...c, children: [] }))

	mapCommentsById.forEach((comment) => {
		if (!comment.parentId) return
		if (comment.parentId === comment.id) return

		const parentComment = mapCommentsById.get(comment.parentId)

		if (parentComment) {
			parentComment.children.push(comment)
			comment.parentComment = parentComment
			// Only top-level comments stay in the map.
			mapCommentsById.delete(comment.id)
		}
	})

	const commentThreads = Array.from(mapCommentsById.values())
	commentThreads.sort((a, b) => a.createdAt - b.createdAt)
	commentThreads.forEach((thread) => sortCommentThreadByDate(thread))

	return commentThreads
}
