import { useProductComments, type ProductComment, type ProductCommentThread } from '@/queries/comments'
import { usePublishCommentMutation } from '@/publish/comments'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { UserNameWithBadge } from './UserNameWithBadge'
import { CircleX, MessageSquare, Reply, X } from 'lucide-react'
import { useUserProfile } from '@/queries/bugReports'
import { ProfileName } from './ProfileName'
import { useProfileName } from '@/queries/profiles'
import { npubEncode } from 'nostr-tools/nip19'

interface IdentifierProductComment {
	id: string
	authorPubkey: string
}

interface ProductCommentsProps {
	productCoordinates: string
	merchantPubkey: string
	replyingToComment?: IdentifierProductComment
	onRemoveReplyTo: () => void
}

function formatDate(timestamp: number): string {
	const date = new Date(timestamp * 1000)
	return date.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	})
}

interface CommentItemProps {
	comment: ProductCommentThread
	onPressReply: (comment: IdentifierProductComment) => void
	isReply?: boolean
	parentAuthorPubkey?: string
}

function CommentItem({ comment, onPressReply, isReply = false, parentAuthorPubkey }: CommentItemProps) {
	// Get parent comment author name, if applicable
	const { data: userParentAuthor, isLoading } = useUserProfile(parentAuthorPubkey ?? '')
	const npubUserParentAuthor = parentAuthorPubkey ? npubEncode(parentAuthorPubkey) : null
	const textUserParentAuthor =
		userParentAuthor?.displayName ??
		userParentAuthor?.name ??
		(npubUserParentAuthor ? npubUserParentAuthor.slice(0, 9) + '..' + npubUserParentAuthor.slice(-6) : '')

	// Only add an indent for threaded replies if the comment is a top-level comment (i.e. `isReply === false`)
	const classIndentTopLevelComment = isReply === false ? 'ml-8' : ''

	return (
		<>
			<div className="border-b border-gray-200 py-4 last:border-b-0">
				<div className="flex items-center justify-between mb-3">
					<UserNameWithBadge pubkey={comment.authorPubkey} />
					<span className="text-sm text-gray-500">{formatDate(comment.createdAt)}</span>
				</div>

				{comment.parentId && <p className="text-xs mb-1">Replying to: {textUserParentAuthor}</p>}

				<p className="text-gray-700 whitespace-pre-wrap mb-1">{comment.content}</p>

				<button
					className="text-sm font-medium text-gray-600 hover:text-gray-400 cursor-pointer p-2 rounded"
					onClick={() => onPressReply({ id: comment.id, authorPubkey: comment.authorPubkey })}
				>
					<div className="flex gap-2 normal-case items-center">
						<Reply />
						Reply...
					</div>
				</button>
			</div>
			<div className={'flex-col gap-2 ' + classIndentTopLevelComment}>
				{comment.children.map((commentChild) => (
					<CommentItem
						key={commentChild.id}
						comment={commentChild}
						isReply
						onPressReply={() => onPressReply(commentChild)}
						parentAuthorPubkey={comment.authorPubkey}
					/>
				))}
			</div>
		</>
	)
}

function AddCommentForm({ productCoordinates, merchantPubkey, replyingToComment, onRemoveReplyTo }: ProductCommentsProps) {
	const [content, setContent] = useState('')
	const publishMutation = usePublishCommentMutation()

	/** Reply to - display user name */
	const { data: userReplyingTo, isLoading } = useUserProfile(replyingToComment?.authorPubkey ?? '')
	const npubUserReplyingTo = replyingToComment?.authorPubkey ? npubEncode(replyingToComment?.authorPubkey) : null
	const textUserReplyingTo =
		userReplyingTo?.displayName ??
		userReplyingTo?.name ??
		(npubUserReplyingTo ? npubUserReplyingTo.slice(0, 9) + '..' + npubUserReplyingTo.slice(-6) : '')

	const handleSubmit = async () => {
		if (!content.trim()) return

		try {
			await publishMutation.mutateAsync({
				content: content.trim(),
				productCoordinates,
				merchantPubkey,
				parentCommentId: replyingToComment?.id,
				parentCommentPubkey: replyingToComment?.authorPubkey,
			})
			setContent('')
			onRemoveReplyTo()
		} catch {
			// Error handling (toasts) is done in the mutation hook; keep content so user can retry
		}
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<label htmlFor="comment" className="text-sm font-medium text-gray-700">
					Leave a comment
				</label>
				{/** Pill button to display and/or clear "reply to" state */}
				{replyingToComment && (
					<div className="flex items-center rounded-full bg-accent hover:bg-secondary/20 py-0.5 pr-1 pl-2 gap-1 text-xs">
						Replying to: {textUserReplyingTo}
						<X strokeWidth={2} className="w-5 h-5" onClick={onRemoveReplyTo} />
					</div>
				)}
			</div>
			<Textarea
				id="comment"
				value={content}
				onChange={(e) => setContent(e.target.value)}
				placeholder="Share your thoughts about this product..."
				rows={4}
				className="resize-none mt-1"
			/>

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

	const [parentComment, setParentComment] = useState<IdentifierProductComment | undefined>()

	const displayedComments = showAll ? comments : comments?.slice(0, 5)
	const hasMoreComments = comments && comments.length > 5

	return (
		<div className="space-y-6">
			{/* Add Comment Form - only show for authenticated users */}
			{isAuthenticated ? (
				<AddCommentForm
					productCoordinates={productCoordinates}
					merchantPubkey={merchantPubkey}
					replyingToComment={parentComment}
					onRemoveReplyTo={() => setParentComment(undefined)}
				/>
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
							<div className="flex-col gap-2">
								<CommentItem key={comment.id} comment={comment} onPressReply={setParentComment} />
							</div>
						))}

						{hasMoreComments && !showAll && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => setShowAll(true)}
								className="w-full text-center py-3 text-secondary hover:text-secondary/80 font-medium"
							>
								Show More
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
