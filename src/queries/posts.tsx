import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { postKeys } from './queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'

export type NostrPost = {
	id: string
	content: string
	author: string
	createdAt: number
}

const transformEvent = (event: NDKEvent): NostrPost => ({
	id: event.id,
	content: event.content,
	author: event.pubkey,
	createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
})

export const fetchPosts = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [1], // kind 1 is text notes
		limit: 200,
		// Expand time window to surface more results for the dashboard feed
		since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30, // last 30 days
	}

	let posts: NostrPost[] = []
	try {
		const events = await ndk.fetchEvents(filter)
		posts = Array.from(events).map(transformEvent)
	} catch (error) {
		console.warn('Failed to fetch Nostr posts:', error)
		posts = []
	}

	// Sort by newest first
	const sorted = posts.sort((a, b) => b.createdAt - a.createdAt)

	// Fallback content: show helpful placeholders if nothing was returned
	if (sorted.length === 0) {
		const now = Math.floor(Date.now() / 1000)
		return [
			{
				id: 'placeholder-1',
				content: 'Welcome to your Nostr Dashboard. Once your relays are connected, latest notes will appear here.',
				author: '0000000000000000000000000000000000000000000000000000000000000000',
				createdAt: now,
			},
			{
				id: 'placeholder-2',
				content: 'Tip: Add or verify relays in Settings → Network to improve feed freshness.',
				author: '0000000000000000000000000000000000000000000000000000000000000000',
				createdAt: now - 60,
			},
			{
				id: 'placeholder-3',
				content: 'You can still browse products and messages while relays sync.',
				author: '0000000000000000000000000000000000000000000000000000000000000000',
				createdAt: now - 120,
			},
		]
	}

	return sorted
}

export const fetchPost = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Post not found')
	}
	return transformEvent(event)
}

export const postQueryOptions = (id: string) =>
	queryOptions({
		queryKey: postKeys.details(id),
		queryFn: () => fetchPost(id),
	})

export const postsQueryOptions = queryOptions({
	queryKey: postKeys.all,
	queryFn: fetchPosts,
	staleTime: 10000,
	gcTime: 5 * 60 * 1000,
})
