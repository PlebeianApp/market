import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { liveActivityKeys } from '@/queries/queryKeyFactory'
import { createLiveChatMessageTemplate } from '@sdk/commerce/messaging'

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

	// Build the event through SDK rules, then sign and publish at the app boundary.
	const template = createLiveChatMessageTemplate({
		liveActivityCoord,
		content,
		relayHint,
		createdAt: Math.floor(Date.now() / 1000),
	})

	const event = new NDKEvent(ndk)
	event.kind = template.kind
	event.content = template.content
	event.created_at = template.created_at
	event.tags = template.tags
	event.pubkey = user.pubkey

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
