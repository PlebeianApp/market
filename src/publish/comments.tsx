import { type Comment } from '@/queries/comments'
import { ndkActions } from '@/lib/stores/ndk'
import { commentKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { isAddressableKind } from 'nostr-tools/kinds'

// NIP-22 Comment kind
const COMMENT_KIND = 1111

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

	const user = await ndk.signer.user()
	if (!user) throw new Error('No active user')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays. Please check your relay connections and try again.')
	}

	// Create NIP-22 comment event
	const commentEvent = new NDKEvent(ndk)
	commentEvent.kind = COMMENT_KIND
	commentEvent.content = content
	commentEvent.created_at = Math.floor(Date.now() / 1000)
	commentEvent.pubkey = user.pubkey

	const tags: string[][] = []

	// === ROOT SCOPE (Uppercase) ===
	if (isAddressableKind(targetEvent.kind)) {
		// Addressable Event (e.g., NIP-99 Product 30402)
		const targetAddress = targetEvent.tagAddress()

		tags.push(['A', targetAddress])
	} else {
		// Regular Event (e.g., Kind 1, 4, etc.)
		tags.push(['E', targetEvent.id])
	}

	// Root Kind
	tags.push(['K', targetEvent.kind.toString()])

	// Root Pubkey
	tags.push(['P', targetEvent.pubkey])

	// === PARENT SCOPE (Lowercase) ===
	if (parentComment) {
		// This is a reply to another comment

		// Note: In NIP-22, replies to comments often use 'e' if the comment is treated as a regular event,
		// or 'a' if the comment is addressable. Since we don't have the full parent event here,
		// we default to 'e' for replies unless we know the parent is addressable.

		tags.push(['e', parentComment.id])
		tags.push(['k', '1111']) // Parent should be a comment (kind '1111')
		tags.push(['p', parentComment?.authorPubkey])
	} else {
		// Top-level comment on the target
		if (isAddressableKind(targetEvent.kind)) {
			// Addressable Target
			const targetAddress = targetEvent.tagAddress()

			tags.push(['a', targetAddress])
		} else {
			// Regular Target
			tags.push(['e', targetEvent.id])
		}
		tags.push(['k', targetEvent.kind.toString()])
		tags.push(['p', targetEvent.pubkey])
	}

	commentEvent.tags = tags

	try {
		await commentEvent.sign(ndk.signer)
		const publishedRelays = await commentEvent.publish()

		if (publishedRelays.size === 0) {
			throw new Error('Comment was not published to any relays.')
		}

		return commentEvent
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
				? variables.targetEvent.tagAddress()
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
