import { postKeys } from './queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { buildPostByIdFilter, buildRecentPostsFilter, parsePost, sortPostsNewestFirst } from '@sdk/commerce/messaging'

export type { NostrPost } from '@sdk/commerce/messaging'

export const fetchPosts = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents(buildRecentPostsFilter())
	return sortPostsNewestFirst(Array.from(events).map(parsePost))
}

export const fetchPost = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(buildPostByIdFilter(id))
	if (!event) {
		throw new Error('Post not found')
	}
	return parsePost(event)
}

export const postQueryOptions = (id: string) =>
	queryOptions({
		queryKey: postKeys.details(id),
		queryFn: () => fetchPost(id),
	})

export const postsQueryOptions = queryOptions({
	queryKey: postKeys.all,
	queryFn: fetchPosts,
})
