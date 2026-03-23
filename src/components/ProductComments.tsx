import { UserNameWithBadge } from '@/components/UserNameWithBadge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { authStore } from '@/lib/stores/auth'
import { useComments } from '@/queries/comments'
import { usePublishComment } from '@/publish/comments'
import { useStore } from '@tanstack/react-store'
import { formatDistance } from 'date-fns'
import { Loader2, MessageCircle } from 'lucide-react'
import { useState } from 'react'

interface ProductCommentsProps {
	productAddress: string
}

export function ProductComments({ productAddress }: ProductCommentsProps) {
	const [commentText, setCommentText] = useState('')
	const { isAuthenticated } = useStore(authStore)
	const { data: comments, isLoading, error, refetch } = useComments(productAddress)

	const publishComment = usePublishComment(productAddress, () => {
		setCommentText('')
		refetch()
	})

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!commentText.trim()) return

		try {
			await publishComment.mutateAsync({ content: commentText })
		} catch (err) {
			console.error('Failed to post comment:', err)
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<MessageCircle className="h-5 w-5 text-gray-500" />
				<h3 className="text-lg font-medium">Comments</h3>
				{comments && comments.length > 0 && <span className="text-sm text-gray-500">({comments.length})</span>}
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="h-6 w-6 animate-spin text-gray-400" />
				</div>
			) : error ? (
				<div className="text-center py-4 text-red-500">Failed to load comments. Please try again.</div>
			) : (
				<>
					<div className="space-y-4">
						{comments && comments.length > 0 ? (
							comments.map((comment) => (
								<div key={comment.id} className="bg-white rounded-lg p-4 shadow-sm">
									<div className="flex items-center justify-between mb-2">
										<UserNameWithBadge pubkey={comment.authorPubkey} />
										<span className="text-xs text-gray-500">
											{formatDistance(new Date(comment.createdAt * 1000), new Date(), { addSuffix: true })}
										</span>
									</div>
									<p className="text-gray-700 whitespace-pre-wrap break-words">{comment.content}</p>
								</div>
							))
						) : (
							<div className="text-center py-8 text-gray-500">
								<MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
								<p>No comments yet. Be the first to leave a comment!</p>
							</div>
						)}
					</div>
				</>
			)}

			<div className="border-t pt-4">
				{isAuthenticated ? (
					<form onSubmit={handleSubmit} className="space-y-3">
						<Textarea
							value={commentText}
							onChange={(e) => setCommentText(e.target.value)}
							placeholder="Write a comment..."
							className="min-h-[100px]"
							maxLength={10000}
						/>
						<div className="flex justify-end">
							<Button type="submit" variant="primary" disabled={!commentText.trim() || publishComment.isPending}>
								{publishComment.isPending ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin mr-2" />
										Posting...
									</>
								) : (
									'Post Comment'
								)}
							</Button>
						</div>
					</form>
				) : (
					<div className="text-center py-4 bg-gray-50 rounded-lg">
						<p className="text-gray-600">Please log in to leave a comment</p>
					</div>
				)}
			</div>
		</div>
	)
}
