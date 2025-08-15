import { postsQueryOptions } from '@/queries/posts'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { PostView } from '@/components/PostView'
import * as React from 'react'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/posts/')({
	loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(postsQueryOptions),
	component: PostsRoute,
})

function PostsRoute() {
	const postsQuery = useSuspenseQuery(postsQueryOptions)
	const posts = postsQuery.data
 	const [visibleCount, setVisibleCount] = React.useState(20)
 	const canLoadMore = posts.length > visibleCount

	return (
		<div className="p-4">
			<h1 className="text-2xl font-bold mb-4">Nostr Posts</h1>
			{posts.length === 0 ? (
				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">No posts yet. Connecting to relays…</div>
					<div className="grid grid-cols-1 gap-3">
						{Array.from({ length: 3 }).map((_, i) => (
							<div key={i} className="border p-4 rounded-lg animate-pulse space-y-2">
								<div className="flex items-center gap-3">
									<div className="w-10 h-10 rounded-full bg-gray-200" />
									<div className="space-y-1">
										<div className="w-24 h-3 bg-gray-200 rounded" />
										<div className="w-36 h-2 bg-gray-100 rounded" />
									</div>
								</div>
								<div className="w-full h-3 bg-gray-100 rounded" />
								<div className="w-5/6 h-3 bg-gray-100 rounded" />
							</div>
						))}
					</div>
				</div>
			) : (
				<div className="space-y-4">
					{posts.slice(0, visibleCount).map((post) => (
						<PostView key={post.id} post={post} />
					))}
					{canLoadMore && (
						<div className="flex justify-center pt-2">
							<Button
								onClick={() => setVisibleCount((n) => n + 20)}
								className="bg-black text-white hover:bg-black/90"
							>
								Load more
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
