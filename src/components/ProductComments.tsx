import { UserNameWithBadge } from '@/components/UserNameWithBadge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { authStore } from '@/lib/stores/auth'
import { useComments, type CommentData } from '@/queries/comments'
import { useDeleteComment, usePublishComment } from '@/publish/comments'
import { useStore } from '@tanstack/react-store'
import { formatDistance } from 'date-fns'
import { Loader2, MessageCircle, Trash2 } from 'lucide-react'
import { useState } from 'react'

interface ProductCommentsProps {
	productAddress: string
}

interface CommentItemProps {
	comment: CommentData
	productAddress: string
	currentUserPubkey: string | undefined
	isAuthenticated: boolean
	depth?: number
}

function CommentItem({ comment, productAddress, currentUserPubkey, isAuthenticated, depth = 0 }: CommentItemProps) {
	const [showReplyForm, setShowReplyForm] = useState(false)
	const [replyText, setReplyText] = useState('')
	const [showReplies, setShowReplies] = useState(true)

	const publishComment = usePublishComment(productAddress, () => {
		setReplyText('')
		setShowReplyForm(false)
	})

	const deleteComment = useDeleteComment(productAddress)

	const handleReply = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!replyText.trim()) return
		try {
			await publishComment.mutateAsync({ content: replyText, parentCommentId: comment.id })
		} catch (err) {
			console.error('Failed to post reply:', err)
		}
	}

	const handleDelete = async () => {
		if (!confirm('Are you sure you want to delete this comment?')) return
		try {
			await deleteComment.mutateAsync(comment.id)
		} catch (err) {
			console.error('Failed to delete comment:', err)
		}
	}

	const isOwnComment = currentUserPubkey === comment.authorPubkey
	const maxDepth = 3

	return (
		<div className={`${depth > 0 ? 'ml-4 pl-4 border-l-2 border-gray-200' : ''}`}>
			<div className="bg-white rounded-lg p-4 shadow-sm mb-2">
				<div className="flex items-center justify-between mb-2">
					<div className="flex items-center gap-2">
						<UserNameWithBadge pubkey={comment.authorPubkey} />
						<span className="text-xs text-gray-500">
							{formatDistance(new Date(comment.createdAt * 1000), new Date(), { addSuffix: true })}
						</span>
					</div>
					<div className="flex items-center gap-2">
						{isAuthenticated && depth < maxDepth && (
							<button type="button" onClick={() => setShowReplyForm(!showReplyForm)} className="text-xs text-blue-600 hover:text-blue-800">
								{showReplyForm ? 'Cancel' : 'Reply'}
							</button>
						)}
						{isOwnComment && (
							<button
								type="button"
								onClick={handleDelete}
								disabled={deleteComment.isPending}
								className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						)}
					</div>
				</div>
				<p className="text-gray-700 whitespace-pre-wrap break-words">{comment.content}</p>
			</div>

			{showReplyForm && isAuthenticated && (
				<form onSubmit={handleReply} className="mb-4 ml-4">
					<Textarea
						value={replyText}
						onChange={(e) => setReplyText(e.target.value)}
						placeholder="Write a reply..."
						className="min-h-[80px] text-sm"
						maxLength={10000}
					/>
					<div className="flex justify-end mt-2 gap-2">
						<Button type="button" variant="ghost" size="sm" onClick={() => setShowReplyForm(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" size="sm" disabled={!replyText.trim() || publishComment.isPending}>
							{publishComment.isPending ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin mr-1" />
									Posting...
								</>
							) : (
								'Post Reply'
							)}
						</Button>
					</div>
				</form>
			)}

			{comment.replies && comment.replies.length > 0 && (
				<div className="mt-2">
					<button type="button" onClick={() => setShowReplies(!showReplies)} className="text-xs text-gray-500 hover:text-gray-700 mb-2">
						{showReplies ? 'Hide' : 'Show'} {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
					</button>
					{showReplies &&
						comment.replies.map((reply) => (
							<CommentItem
								key={reply.id}
								comment={reply}
								productAddress={productAddress}
								currentUserPubkey={currentUserPubkey}
								isAuthenticated={isAuthenticated}
								depth={depth + 1}
							/>
						))}
				</div>
			)}
		</div>
	)
}

export function ProductComments({ productAddress }: ProductCommentsProps) {
	const [commentText, setCommentText] = useState('')
	const { user } = useStore(authStore)
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

	const currentUserPubkey = user?.pubkey

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
								<CommentItem
									key={comment.id}
									comment={comment}
									productAddress={productAddress}
									currentUserPubkey={currentUserPubkey}
									isAuthenticated={isAuthenticated}
								/>
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
