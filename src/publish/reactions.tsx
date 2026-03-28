import { getCoordinates, getCoordinatesOrId } from '@/lib/nostr/coordinates'
import { ndkActions } from '@/lib/stores/ndk'
import { reactionKeys } from '@/queries/queryKeyFactory'
import type { Reaction } from '@/queries/reactions'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAddressableKind } from 'nostr-tools/kinds'
import { toast } from 'sonner'

// NIP-25 Reaction kind
const REACTION_KIND = 7

interface PublishReactionParams {
	emoji: string
	event: NDKEvent
}

interface PublishDeletionParams {
	reactionEvent: Reaction
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

	if (isAddressableKind(event.kind)) {
		// Add 'a' tag with coordinates (kind:pubkey:d-tag)
		const coordinates = getCoordinates(event)
		const aTag = ['a', coordinates]
		tags.push(aTag)
	} else {
		// Add 'e' tag with target event id
		const eTag = ['e', event.id]
		tags.push(eTag)
	}

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
 * Publishes a deletion event for reactions (NIP-09)
 * This event references reactions to be deleted using 'e' tags
 * @param reactionEvent Reaction Event to Delete
 * @returns Promise awaiting deletion event publish
 */
export const publishDeletionEvent = async ({ reactionEvent }: PublishDeletionParams): Promise<NDKEvent> => {
	console.log('Requesting deletion...')

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const user = await ndk.signer.user()
	if (!user) throw new Error('No active user')

	// Create deletion event (kind 5)
	const deletionEvent = new NDKEvent(ndk)
	deletionEvent.kind = 5
	deletionEvent.content = `Removed reaction: ${reactionEvent.emoji}`
	deletionEvent.created_at = Math.floor(Date.now() / 1000)
	deletionEvent.pubkey = user.pubkey

	// Build tags according to NIP-09 deletion request format
	const tags: string[][] = []

	// Add 'e' tag with the reaction event id (the reaction event itself)
	const eTag = ['e', reactionEvent.id]
	tags.push(eTag)

	// Add 'p' tag with the reaction event author pubkey
	const pTag = ['p', reactionEvent.authorPubkey]
	tags.push(pTag)

	if (isAddressableKind(reactionEvent.targetEvent.kind)) {
		// Add 'a' tag with coordinates for reaction target (kind:pubkey:d-tag)
		const coordinates = getCoordinates(reactionEvent.targetEvent)
		const aTag = ['a', `${reactionEvent.targetEvent.kind}:${reactionEvent.targetEvent.pubkey}:${coordinates}`]
		tags.push(aTag)
	}

	// Add 'k' tag with the kind of the reaction event
	const kTag = ['k', REACTION_KIND.toString()]
	tags.push(kTag)

	deletionEvent.tags = tags

	try {
		await deletionEvent.sign(ndk.signer)
		await deletionEvent.publish()

		return deletionEvent
	} catch (error) {
		console.error('Error publishing deletion event:', error)
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

/**
 * Mutation hook for publishing a deletion event
 */
export const usePublishDeletionMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishDeletionEvent,
		onSuccess: async (_, variables) => {
			// Invalidate reactions query for the target event
			await queryClient.invalidateQueries({
				queryKey: reactionKeys.byEvent(variables.reactionEvent.targetEvent.id, variables.reactionEvent.targetEvent.pubkey),
			})
		},
		onError: (error) => {
			console.error('Failed to publish deletion event:', error)
			toast.error('Failed to remove reaction')
		},
	})
}
