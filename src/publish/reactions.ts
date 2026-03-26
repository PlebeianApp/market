import { ndkActions } from '@/lib/stores/ndk'
import { reactionKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// NIP-25 Reaction kind
const REACTION_KIND = 7

interface PublishReactionParams {
	emoji: string
	event: NDKEvent
}

/**
 * Publishes a NIP-25 reaction to an event
 *
 * @param emoji - The reaction emoji/content (e.g., '+', '-', '❤️', ':custom:')
 * @param event - The target NDKEvent to react to
 * @returns Promise that resolves to the published reaction event
 */
export const publishReaction = async ({ emoji, event }: PublishReactionParams): Promise<NDKEvent> => {
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

	// Build tags according to NIP-25 specification
	const tags: string[][] = []

	// Add 'e' tag with target event id
	// The relay hint is optional and typically added by the relay itself
	const eTag = ['e', event.id]
	tags.push(eTag)

	// Add 'a' tag with coordinates (kind:pubkey:d-tag) - same as e tag
	const aTag = ['a', `${event.kind}:${event.pubkey}:${event.id}`]
	tags.push(aTag)

	// Add 'p' tag with target event author pubkey
	const pTag = ['p', event.pubkey]
	tags.push(pTag)

	// Add 'k' tag with the kind of the target event
	const kTag = ['k', event.kind.toString()]
	tags.push(kTag)

	reactionEvent.tags = tags

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
				queryKey: reactionKeys.byEvent(variables.event.id, variables.event.pubkey),
			})
			toast.success('Reaction posted!')
		},
		onError: (error) => {
			console.error('Failed to publish reaction:', error)
			toast.error('Failed to post reaction')
		},
	})
}
