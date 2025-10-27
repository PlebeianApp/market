import { Link } from '@tanstack/react-router'
import type { NostrPost } from '@/queries/posts'
import { authorQueryOptions } from '@/queries/authors'
import { useQuery } from '@tanstack/react-query'

interface PostViewProps {
	post: NostrPost
	showJson?: boolean
}

export function PostView({ post, showJson = false }: PostViewProps) {
	const { data: author, isLoading: isLoadingAuthor } = useQuery(authorQueryOptions(post.author))

	return (
		<div className="border p-4 rounded-lg">
			<div className="flex items-center mb-3">
				{isLoadingAuthor ? (
					<div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse"></div>
				) : author?.picture ? (
					<img src={author.picture} alt={author.name || 'Profile'} className="w-10 h-10 rounded-full object-cover object-center" />
				) : (
					<div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600">
						{author?.name?.[0]?.toUpperCase() || '?'}
					</div>
				)}
				<div className="ml-3">
					<div className="font-medium">
						{isLoadingAuthor ? (
							<div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div>
						) : (
							author?.name || post.author.slice(0, 8) + '...'
						)}
					</div>
					<div className="text-xs text-gray-500">{new Date(post.createdAt * 1000).toLocaleString()}</div>
				</div>
			</div>
			<p>{post.content}</p>
			<Link to="/posts/$postId" params={{ postId: post.id }} className="text-sm text-blue-500 underline mb-2 block mt-2">
				{post.id.slice(0, 8)}...
			</Link>
			{showJson && <pre className="bg-gray-100 p-4 rounded-lg whitespace-pre-wrap mt-4">{JSON.stringify(post, null, 2)}</pre>}
		</div>
	)
}
