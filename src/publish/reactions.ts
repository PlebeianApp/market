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

interface PublishDeletionParams {
	emoji: string
	targetEventId: string
	targetEventKind: string | undefined
	targetAuthorPubkey: string
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
 * Publishes a deletion event for reactions (NIP-09)
 * This event references reactions to be deleted using 'e' tags
 *
 * @param emoji - The emoji being deleted
 * @param targetEventId - The ID of the target event being reacted to
 * @param targetEventKind - The kind of the target event
 * @param targetAuthorPubkey - The pubkey of the target event author
 * @returns Promise that resolves to the published deletion event
 */
export const publishDeletionEvent = async (params: PublishDeletionParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const user = await ndk.signer.user()
	if (!user) throw new Error('No active user')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays. Please check your relay connections and try again.')
	}

	// Create deletion event (kind 5)
	const deletionEvent = new NDKEvent(ndk)
	deletionEvent.kind = 5
	deletionEvent.content = `Removed reaction: ${params.emoji}`
	deletionEvent.created_at = Math.floor(Date.now() / 1000)
	deletionEvent.pubkey = user.pubkey

	// Build tags according to NIP-09 deletion request format
	const tags: string[][] = []

	// Add 'a' tag with the reaction coordinates
	if (params.targetEventKind && params.targetAuthorPubkey) {
		const aTag = ['a', `${params.targetEventKind}:${params.targetAuthorPubkey}:${params.targetEventId}`]
		tags.push(aTag)
	}

	// Add 'k' tag with the kind of the target event
	if (params.targetEventKind) {
		const kTag = ['k', params.targetEventKind]
		tags.push(kTag)
	}

	deletionEvent.tags = tags

	try {
		await deletionEvent.sign(ndk.signer)
		const publishedRelays = await deletionEvent.publish()

		if (publishedRelays.size === 0) {
			throw new Error('Deletion event was not published to any relays.')
		}

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
		onSuccess: async () => {
			// Invalidate reactions query for the target event
			// Note: We need to pass the actual event to invalidate properly
			// This will be handled by the caller passing the event
		},
		onError: (error) => {
			console.error('Failed to publish deletion event:', error)
			toast.error('Failed to remove reaction')
		},
	})
}
