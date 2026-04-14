import {
	MAX_COMMENT_THREAD_DEPTH,
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
import SocialInteractions from './social/SocialInteractions'
import { toast } from 'sonner'

interface CommentItemProps {
	comment: CommentThread
	onPressReply: (comment?: Comment) => void
}

interface CommentThreadProps {
	comments: CommentThread[]
	eventRoot: NDKEvent
	replyingTo?: Comment
	setReplyingTo: (comment?: Comment) => void
	depth?: number
}

interface AddCommentProps {
	targetEvent: NDKEvent
	parentComment?: Comment
	onCancel?: () => void
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

function CommentItem({ comment, onPressReply }: CommentItemProps) {
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

	return (
		<div className="relative border-b border-gray-200 py-2 my-4 last:border-b-0">
			<div className="flex items-center justify-between mb-3">
				<UserCard pubkey={comment.authorPubkey} />
				<span className="text-sm text-gray-500">{formatDate(comment.createdAt)}</span>
			</div>

			{comment.parentComment && <p className="text-xs mb-1">Replying to: {textUserParentAuthor}</p>}

			<p className="text-gray-700 whitespace-pre-wrap mb-1">{comment.content}</p>

			<SocialInteractions
				event={comment.event}
				onCommentButtonPressed={() => {
					if (!isAuthenticated) {
						toast.error('You must be logged in to comment')
						return
					}
					onPressReply(comment)
				}}
				showCommentAsReplyIcon
				hideShareButton
				buttonVariant="ghost"
				combineZapsAndReactions
				className="comment-social-interactions flex-row items-center"
			/>
		</div>
	)
}

function CommentThread({ comments, replyingTo, eventRoot, setReplyingTo, depth = 0 }: CommentThreadProps) {
	return (
		<>
			{comments.map((commentChild) => (
				<>
					<CommentItem key={'comment-' + commentChild.id} comment={commentChild} onPressReply={() => setReplyingTo(commentChild)} />
					{replyingTo && replyingTo.id === commentChild.id ? (
						<AddCommentForm
							key={'add-comment-' + commentChild.id}
							targetEvent={eventRoot}
							parentComment={commentChild}
							onCancel={() => setReplyingTo()}
						/>
					) : null}
					{commentChild.children && commentChild.children.length > 0 && depth < MAX_COMMENT_THREAD_DEPTH - 1 ? (
						<div key={'comment-thread-' + commentChild.id} className="flex-col gap-2 pl-8 border-l border-gray-200">
							<CommentThread
								comments={commentChild.children}
								replyingTo={replyingTo}
								eventRoot={eventRoot}
								setReplyingTo={setReplyingTo}
								depth={depth + 1}
							/>
						</div>
					) : null}
				</>
			))}
		</>
	)
}

function AddCommentForm({ targetEvent, parentComment, onCancel }: AddCommentProps) {
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
			onCancel?.()
		} catch {
			// Error handling (toasts) is done in the mutation hook; keep content so user can retry
		}
	}

	const handleCancel = async () => {
		if (parentComment) {
			// If this is a reply field, then call onCancel to hide this form
			onCancel?.()
		} else {
			// Else, clear content
			setContent('')
		}
	}

	const disableCancel = !onCancel || publishMutation.isPending
	const disableSubmit = !content.trim() || publishMutation.isPending

	return (
		<div className="space-y-2">
			{parentComment && (
				<div className="flex items-center gap-2 mb-2">
					<Reply className="w-4 h-4 text-gray-500" />
					<span className="text-sm text-gray-600">Replying to: {textUserReplyingTo}</span>
				</div>
			)}
			<Textarea
				id="comment-input"
				value={content}
				onChange={(e) => setContent(e.target.value)}
				placeholder={parentComment ? 'Write your reply...' : 'Share your thoughts about this product...'}
				rows={4}
				className="resize-none"
			/>

			<div className="flex justify-end gap-2">
				<Button variant="outline" onClick={handleCancel} disabled={disableCancel}>
					Cancel
				</Button>
				<Button variant="secondary" onClick={handleSubmit} disabled={disableSubmit}>
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
	const [replyingTo, setReplyingTo] = useState<Comment | undefined>(undefined)

	const commentThreads = comments && transformCommentsIntoThreads(comments)
	const displayedComments = showAll ? commentThreads : commentThreads?.slice(0, 5)
	const hasMoreComments = commentThreads && commentThreads.length > 5

	return (
		<div className="space-y-6" id="comments-section">
			{/* Add Comment Form - only show for authenticated users */}
			{isAuthenticated ? (
				<AddCommentForm targetEvent={targetEvent} />
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
						<CommentThread comments={displayedComments} eventRoot={targetEvent} setReplyingTo={setReplyingTo} replyingTo={replyingTo} />

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
