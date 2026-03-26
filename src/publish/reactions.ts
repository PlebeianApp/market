import { ndkActions } from '@/lib/stores/ndk'
import { reactionKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// NIP-25 Reaction kind
const REACTION_KIND = 999

interface PublishReactionParams {
	emoji: string
	eventId: string
	authorPubkey: string
}

/**
 * Publishes a NIP-25 reaction to an event
 */
export const publishReaction = async ({ emoji, eventId, authorPubkey }: PublishReactionParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const user = await ndk.signer.user()
	if (!user) throw new Error('No active user')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays. Please check your relay connections and try again.')
	}

	// Create NIP-25 reaction event
	const reactionEvent = new NDKEvent(ndk)
	reactionEvent.kind = REACTION_KIND
	reactionEvent.content = emoji
	reactionEvent.created_at = Math.floor(Date.now() / 1000)
	reactionEvent.pubkey = user.pubkey
	reactionEvent.tags = [
		// Reference the target event
		['e', eventId],
		['k', '1'], // Kind 1 is text notes (most common target)
		['p', authorPubkey], // Author of the target event
		// Reference the reaction author
		['a', user.pubkey],
	]

	try {
		await reactionEvent.sign(ndk.signer)
		const publishedRelays = await reactionEvent.publish()

		if (publishedRelays.size === 0) {
			throw new Error('Reaction was not published to any relays.')
		}

		return reactionEvent
	} catch (error) {
		console.error('Error publishing reaction:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a reaction
 */
export const usePublishReactionMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishReaction,
		onSuccess: async (_, variables) => {
			// Invalidate reactions query for the target event
			await queryClient.invalidateQueries({
				queryKey: reactionKeys.byEvent(variables.eventId, variables.authorPubkey),
			})
			toast.success('Reaction posted!')
		},
		onError: (error) => {
			console.error('Failed to publish reaction:', error)
			toast.error('Failed to post reaction')
		},
	})
}
