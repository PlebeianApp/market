import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LIVE_CHAT_KIND } from '@/lib/nip53'
import { liveActivityKeys } from '@/queries/queryKeyFactory'

interface PublishLiveChatMessageParams {
	liveActivityCoord: string
	content: string
}

export const publishLiveChatMessage = async ({ liveActivityCoord, content }: PublishLiveChatMessageParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const user = await ndk.signer.user()
	if (!user) throw new Error('No active user')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays')
	}

	const relayHint = connectedRelays[0]?.url ?? ''

	const event = new NDKEvent(ndk)
	event.kind = LIVE_CHAT_KIND
	event.content = content
	event.created_at = Math.floor(Date.now() / 1000)
	event.pubkey = user.pubkey
	event.tags = [['a', liveActivityCoord, relayHint, 'root']]

	await event.sign(ndk.signer)
	await ndkActions.publishEvent(event)

	return event
}

export const usePublishLiveChatMessageMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishLiveChatMessage,
		onSuccess: async (_event, variables) => {
			await queryClient.invalidateQueries({
				queryKey: liveActivityKeys.chatMessages(variables.liveActivityCoord),
			})
		},
		onError: (error) => {
			console.error('Failed to send chat message:', error)
			toast.error('Failed to send message')
		},
	})
}

interface PublishReactionParams {
	messageId: string
	messagePubkey: string
	liveActivityCoord: string
	emoji: string
}

export const publishReaction = async ({ messageId, messagePubkey, emoji }: PublishReactionParams): Promise<void> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const event = new NDKEvent(ndk)
	event.kind = 7
	event.content = emoji
	event.created_at = Math.floor(Date.now() / 1000)
	event.tags = [
		['e', messageId],
		['p', messagePubkey],
		['k', String(LIVE_CHAT_KIND)],
	]

	await event.sign(ndk.signer)
	await ndkActions.publishEvent(event)
}

export const usePublishReactionMutation = () => {
	return useMutation({
		mutationFn: publishReaction,
		onError: (error) => {
			console.error('Failed to publish reaction:', error)
		},
	})
}
