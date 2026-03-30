import {
	transformCommentsMapIntoThreads as transformCommentsIntoThreads,
	useComments,
	type Comment,
	type CommentThread,
} from '@/queries/comments'
import { usePublishCommentMutation } from '@/publish/comments'
import { authStore, useAuth } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { CircleX, MessageSquare, Reply, X } from 'lucide-react'
import { ProfileName } from './ProfileName'
import { useProfile, useProfileName } from '@/queries/profiles'
import { npubEncode } from 'nostr-tools/nip19'
import { UserCard } from './UserCard'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

interface CommentItemProps {
	comment: CommentThread
	onPressReply: (comment: Comment) => void
	isReply?: boolean
}

interface AddCommentProps {
	targetEvent: NDKEvent
	replyingTo?: Comment
	onRemoveReplyTo?: () => void
}

interface CommentsProps {
	targetEvent: NDKEvent
}

function formatDate(timestamp: number): string {
	const date = new Date(timestamp * 1000)
	return date.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	})
}

function CommentItem({ comment, onPressReply, isReply = false }: CommentItemProps) {
	// Get is authenticated for showing/hiding "Reply" button
	const { user: userSelf, isAuthenticated } = useAuth()

	// Get parent comment author name, if applicable
	const pubkeyAuthorParentComment = comment?.parentComment?.authorPubkey ?? ''
	const { data: dataUserParent, isLoading } = useProfile(pubkeyAuthorParentComment)
	const { user: userParent, profile: profileUserParent } = dataUserParent ?? {}
	const npubUserParentAuthor = comment?.parentComment?.authorPubkey ? npubEncode(pubkeyAuthorParentComment) : null
	const textUserParentAuthor =
		profileUserParent?.name ??
		profileUserParent?.displayName ??
		(npubUserParentAuthor ? npubUserParentAuthor.slice(0, 9) + '..' + npubUserParentAuthor.slice(-6) : '')

	// Only add an indent for threaded replies if the comment is a top-level comment (i.e. `isReply === false`)
	const classIndentTopLevelComment = isReply === false ? 'ml-8' : ''

	return (
		<>
			<div className="border-b border-gray-200 py-4 last:border-b-0">
				<div className="flex items-center justify-between mb-3">
					<UserCard pubkey={comment.authorPubkey} />
					<span className="text-sm text-gray-500">{formatDate(comment.createdAt)}</span>
				</div>

				{comment.parentComment && <p className="text-xs mb-1">Replying to: {textUserParentAuthor}</p>}

				<p className="text-gray-700 whitespace-pre-wrap mb-1">{comment.content}</p>

				{isAuthenticated && (
					<button
						className="text-sm font-medium text-gray-600 hover:text-gray-400 cursor-pointer p-2 rounded"
						onClick={() => onPressReply(comment)}
					>
						<div className="flex gap-2 normal-case items-center">
							<Reply />
							Reply...
						</div>
					</button>
				)}
			</div>
			<div className={'flex-col gap-2 ' + classIndentTopLevelComment}>
				{comment.children.map((commentChild) => (
					<CommentItem key={commentChild.id} comment={commentChild} isReply onPressReply={() => onPressReply(commentChild)} />
				))}
			</div>
		</>
	)
}

function AddCommentForm({ targetEvent, replyingTo: parentComment, onRemoveReplyTo }: AddCommentProps) {
	const [content, setContent] = useState('')
	const publishMutation = usePublishCommentMutation()

	/** Reply to - display user name */
	const { data: dataUserReplyingTo, isLoading } = useProfile(parentComment?.authorPubkey ?? '')
	const { user: userReplyingTo, profile: profileUserReplyingTo } = dataUserReplyingTo ?? {}
	const npubUserReplyingTo = parentComment?.authorPubkey ? npubEncode(parentComment?.authorPubkey) : null
	const textUserReplyingTo =
		profileUserReplyingTo?.displayName ??
		profileUserReplyingTo?.name ??
		(npubUserReplyingTo ? npubUserReplyingTo.slice(0, 9) + '..' + npubUserReplyingTo.slice(-6) : '')

	const handleSubmit = async () => {
		if (!content.trim()) return

		try {
			await publishMutation.mutateAsync({
				content: content.trim(),
				targetEvent: targetEvent,
				parentComment: parentComment,
			})
			setContent('')
			onRemoveReplyTo?.()
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
				{parentComment && (
					<div className="flex items-center rounded-full bg-accent hover:bg-secondary/20 py-0.5 pr-1 pl-2 gap-1 text-xs">
						Replying to: {textUserReplyingTo}
						<X strokeWidth={2} className="w-5 h-5" onClick={onRemoveReplyTo} />
					</div>
				)}
			</div>
			<Textarea
				id="comment-input"
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

export function Comments({ targetEvent }: CommentsProps) {
	const { isAuthenticated } = useStore(authStore)
	const { data: comments, isLoading, error } = useComments(targetEvent)
	const [showAll, setShowAll] = useState(false)

	const [parentComment, setParentComment] = useState<Comment | undefined>()

	const commentThreads = comments && transformCommentsIntoThreads(comments)
	const displayedComments = showAll ? commentThreads : commentThreads?.slice(0, 5)
	const hasMoreComments = commentThreads && commentThreads.length > 5

	return (
		<div className="space-y-6" id="comments-section">
			{/* Add Comment Form - only show for authenticated users */}
			{isAuthenticated ? (
				<AddCommentForm targetEvent={targetEvent} replyingTo={parentComment} onRemoveReplyTo={() => setParentComment(undefined)} />
			) : (
				<div className="bg-gray-50 p-4 rounded-lg text-center">
					<p className="text-gray-600">Please log in to leave a comment.</p>
				</div>
			)}

			{/* Comments List */}
			<div data-testid="product-comments">
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
							<div className="flex-col gap-2" key={comment.id}>
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
