import { getEventAddress } from '@/lib/nostr/eventLike'
import { type Comment } from '@/queries/comments'
import { isAddressableKind } from 'nostr-tools/kinds'
import { ndkActions } from '@/lib/stores/ndk'
import { commentKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { publishCommentWorkflow } from '@sdk/commerce/messaging'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'

interface PublishCommentParams {
	content: string
	targetEvent: NDKEvent // The event being commented on (Product, Comment, etc.)
	parentComment?: Comment // For replies to other comments
}

/**
 * Publishes a NIP-22 comment on a target event (Product, Comment, etc.)
 * Automatically handles both addressable (A/a tags) and regular (E/e tags) events.
 */
export const publishComment = async ({ content, targetEvent, parentComment }: PublishCommentParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays. Please check your relay connections and try again.')
	}

	try {
		const context = await createNdkPublishContext(ndk, ndk.signer, async (event) => {
			const publishedRelays = await event.publish()
			if (publishedRelays.size === 0) throw new Error('Comment was not published to any relays.')
		})
		return await publishCommentWorkflow(context, {
			content,
			targetEvent,
			parentComment: parentComment ? { id: parentComment.id, authorPubkey: parentComment.authorPubkey } : undefined,
		})
	} catch (error) {
		console.error('Error publishing comment:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a comment
 */
export const usePublishCommentMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishComment,
		onSuccess: async (event, variables) => {
			const targetCoordinates = isAddressableKind(variables.targetEvent.kind)
				? getEventAddress(variables.targetEvent)
				: variables.targetEvent.id

			await queryClient.invalidateQueries({
				queryKey: commentKeys.byProduct(targetCoordinates),
			})
			toast.success('Comment posted!')
		},
		onError: (error) => {
			console.error('Failed to publish comment:', error)
			toast.error('Failed to post comment')
		},
	})
}
