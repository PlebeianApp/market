import { useProductComments, type ProductComment } from '@/queries/comments'
import { usePublishCommentMutation } from '@/publish/comments'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { UserNameWithBadge } from './UserNameWithBadge'
import { MessageSquare } from 'lucide-react'

interface ProductCommentsProps {
	productCoordinates: string
	merchantPubkey: string
}

function formatDate(timestamp: number): string {
	const date = new Date(timestamp * 1000)
	return date.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	})
}

function CommentItem({ comment }: { comment: ProductComment }) {
	return (
		<div className="border-b border-gray-200 py-4 last:border-b-0">
			<div className="flex items-center justify-between mb-2">
				<UserNameWithBadge pubkey={comment.authorPubkey} />
				<span className="text-sm text-gray-500">{formatDate(comment.createdAt)}</span>
			</div>
			<p className="text-gray-700 whitespace-pre-wrap">{comment.content}</p>
		</div>
	)
}

function AddCommentForm({
	productCoordinates,
	merchantPubkey,
}: {
	productCoordinates: string
	merchantPubkey: string
}) {
	const [content, setContent] = useState('')
	const publishMutation = usePublishCommentMutation()

	const handleSubmit = async () => {
		if (!content.trim()) return

		await publishMutation.mutateAsync({
			content: content.trim(),
			productCoordinates,
			merchantPubkey,
		})

		setContent('')
	}

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<label htmlFor="comment" className="text-sm font-medium text-gray-700">
					Leave a comment
				</label>
				<Textarea
					id="comment"
					value={content}
					onChange={(e) => setContent(e.target.value)}
					placeholder="Share your thoughts about this product..."
					rows={4}
					className="resize-none"
				/>
			</div>
			<div className="flex justify-end gap-2">
				<Button variant="outline" onClick={() => setContent('')} disabled={!content.trim() || publishMutation.isPending}>
					Cancel
				</Button>
				<Button variant="secondary" onClick={handleSubmit} disabled={!content.trim() || publishMutation.isPending}>
					{publishMutation.isPending ? 'Posting...' : 'Submit'}
				</Button>
			</div>
		</div>
	)
}

export function ProductComments({ productCoordinates, merchantPubkey }: ProductCommentsProps) {
	const { isAuthenticated } = useStore(authStore)
	const { data: comments, isLoading, error } = useProductComments(productCoordinates)
	const [showAll, setShowAll] = useState(false)

	const displayedComments = showAll ? comments : comments?.slice(0, 5)
	const hasMoreComments = comments && comments.length > 5

	return (
		<div className="space-y-6">
			{/* Add Comment Form - only show for authenticated users */}
			{isAuthenticated ? (
				<AddCommentForm productCoordinates={productCoordinates} merchantPubkey={merchantPubkey} />
			) : (
				<div className="bg-gray-50 p-4 rounded-lg text-center">
					<p className="text-gray-600">Please log in to leave a comment.</p>
				</div>
			)}

			{/* Comments List */}
			<div>
				{isLoading && <p className="text-gray-500 text-center py-4">Loading comments...</p>}

				{error && <p className="text-red-600 text-center py-4">Failed to load comments</p>}

				{!isLoading && !error && comments && comments.length === 0 && (
					<div className="text-center py-8">
						<MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
						<p className="text-gray-500">No comments yet. Be the first to comment!</p>
					</div>
				)}

				{displayedComments && displayedComments.length > 0 && (
					<div>
						{displayedComments.map((comment) => (
							<CommentItem key={comment.id} comment={comment} />
						))}

						{hasMoreComments && !showAll && (
							<button
								onClick={() => setShowAll(true)}
								className="w-full text-center py-3 text-secondary hover:text-secondary/80 font-medium"
							>
								Show More
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
