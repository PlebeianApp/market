import { ndkActions } from '@/lib/stores/ndk'
import { commentKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// NIP-22 Comment kind
const COMMENT_KIND = 1111

interface PublishCommentParams {
	content: string
	productCoordinates: string // Format: "30018:<pubkey>:<d-tag>"
	merchantPubkey: string
	parentCommentId?: string // For replies to other comments
	parentCommentPubkey?: string
}

/**
 * Publishes a NIP-22 comment on a product
 */
export const publishComment = async ({
	content,
	productCoordinates,
	merchantPubkey,
	parentCommentId,
	parentCommentPubkey,
}: PublishCommentParams): Promise<NDKEvent> => {
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

	// NIP-22 tags structure:
	// - Uppercase tags (A, K, P) for root scope (the product)
	// - Lowercase tags (a, e, k, p) for parent item
	const tags: string[][] = []

	// Root scope: the product (addressable event)
	tags.push(['A', productCoordinates])
	tags.push(['K', '30018']) // Product kind
	tags.push(['P', merchantPubkey])

	if (parentCommentId && parentCommentPubkey) {
		// This is a reply to another comment
		tags.push(['e', parentCommentId, '', parentCommentPubkey])
		tags.push(['k', '1111']) // Parent is a comment
		tags.push(['p', parentCommentPubkey])
	} else {
		// Top-level comment on the product
		tags.push(['a', productCoordinates])
		tags.push(['k', '30018'])
		tags.push(['p', merchantPubkey])
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
		onSuccess: async (_, variables) => {
			// Invalidate comments query to refetch
			await queryClient.invalidateQueries({
				queryKey: commentKeys.byProduct(variables.productCoordinates),
			})
			toast.success('Comment posted!')
		},
		onError: (error) => {
			console.error('Failed to publish comment:', error)
			toast.error('Failed to post comment')
		},
	})
}
