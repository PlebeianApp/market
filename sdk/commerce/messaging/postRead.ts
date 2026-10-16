import type { NostrEventLike } from '../../core/nostr/eventLike'

export const TEXT_NOTE_KIND = 1

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type PostFilter = {
	kinds?: number[]
	ids?: string[]
	limit?: number
}

export type NostrPost = {
	id: string
	content: string
	author: string
	createdAt: number
}

export function buildRecentPostsFilter(): PostFilter {
	return { kinds: [TEXT_NOTE_KIND], limit: 20 }
}

export function buildPostByIdFilter(id: string): PostFilter {
	return { ids: [id] }
}

export function parsePost(event: NostrEventLike): NostrPost {
	return {
		id: event.id,
		content: event.content,
		author: event.pubkey,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
	}
}

/** Newest first; sorts in place. */
export function sortPostsNewestFirst(posts: NostrPost[]): NostrPost[] {
	return posts.sort((a, b) => b.createdAt - a.createdAt)
}
