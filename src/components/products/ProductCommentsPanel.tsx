import { AvatarUser } from '@/components/AvatarUser'
import { ProfileName } from '@/components/ProfileName'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ndkStore } from '@/lib/stores/ndk'
import { publishProductComment } from '@/publish/productComments'
import { productCommentKeys } from '@/queries/queryKeyFactory'
import { MAX_COMMENT_LENGTH, useProductComments } from '@/queries/productComments'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { toast } from 'sonner'

interface ProductCommentsPanelProps {
	productCoords: string
	merchantPubkey: string
}

interface ProductCommentsPanelContentProps {
	comments: NDKEvent[]
	isLoading: boolean
	canCompose: boolean
	isPending: boolean
	draft: string
	onDraftChange: (value: string) => void
	onPublish: () => void
}

const formatCommentTimestamp = (createdAt?: number): string | null => {
	if (!createdAt) return null
	return new Date(createdAt * 1000).toISOString()
}

export function ProductCommentsPanelContent({
	comments,
	isLoading,
	canCompose,
	isPending,
	draft,
	onDraftChange,
	onPublish,
}: ProductCommentsPanelContentProps) {
	if (isLoading) {
		return (
			<div className="rounded-lg bg-white p-6 shadow-md" data-testid="product-comments-loading">
				<p className="text-gray-600">Loading comments…</p>
			</div>
		)
	}

	return (
		<div className="rounded-lg bg-white p-6 shadow-md space-y-6">
			<div className="space-y-3">
				<h3 className="text-lg font-medium">Comments</h3>
				{canCompose ? (
					<div className="space-y-3">
						<Textarea
							value={draft}
							onChange={(event) => onDraftChange(event.target.value)}
							placeholder="Share a comment about this product"
							maxLength={MAX_COMMENT_LENGTH}
							rows={4}
							disabled={isPending}
						/>
						<div className="flex items-center justify-between gap-3">
							<p className="text-sm text-gray-500">
								{draft.trim().length}/{MAX_COMMENT_LENGTH}
							</p>
							<Button onClick={onPublish} disabled={isPending || draft.trim().length === 0}>
								{isPending ? 'Posting…' : 'Post comment'}
							</Button>
						</div>
					</div>
				) : (
					<p className="text-sm text-gray-600" data-testid="product-comments-auth-required">
						Connect a Nostr signer to post a comment.
					</p>
				)}
			</div>

			<div className="space-y-4" data-testid="product-comments-list">
				{comments.length === 0 ? (
					<p className="text-gray-600" data-testid="product-comments-empty">
						No comments yet.
					</p>
				) : (
					comments.map((comment) => (
						<div key={comment.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
							<div className="flex items-center gap-3">
								<AvatarUser pubkey={comment.pubkey} className="w-8 h-8" />
								<div className="min-w-0">
									<ProfileName pubkey={comment.pubkey} className="font-medium text-gray-900" />
									{formatCommentTimestamp(comment.created_at) && (
										<p className="text-xs text-gray-500">{formatCommentTimestamp(comment.created_at)}</p>
									)}
								</div>
							</div>
							<p className="whitespace-pre-wrap break-words text-gray-700">{comment.content}</p>
						</div>
					))
				)}
			</div>
		</div>
	)
}

export function ProductCommentsPanel({ productCoords, merchantPubkey }: ProductCommentsPanelProps) {
	const queryClient = useQueryClient()
	const canCompose = useStore(ndkStore, (state) => Boolean(state.signer))
	const [draft, setDraft] = useState('')
	const commentsQuery = useProductComments(productCoords, merchantPubkey)

	const publishMutation = useMutation({
		mutationFn: () => publishProductComment(productCoords, merchantPubkey, draft),
		onSuccess: async () => {
			setDraft('')
			await queryClient.invalidateQueries({ queryKey: productCommentKeys.list(productCoords) })
			toast.success('Comment posted')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to post comment')
		},
	})

	return (
		<ProductCommentsPanelContent
			comments={commentsQuery.data ?? []}
			isLoading={commentsQuery.isLoading}
			canCompose={canCompose}
			isPending={publishMutation.isPending}
			draft={draft}
			onDraftChange={setDraft}
			onPublish={() => publishMutation.mutate()}
		/>
	)
}
