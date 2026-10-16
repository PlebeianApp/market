import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { liveActivityKeys } from '@/queries/queryKeyFactory'
import { publishLiveChatMessageWorkflow } from '@sdk/commerce/messaging'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'

interface PublishLiveChatMessageParams {
	liveActivityCoord: string
	content: string
}

export const publishLiveChatMessage = async ({ liveActivityCoord, content }: PublishLiveChatMessageParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays')
	}

	const relayHint = connectedRelays[0]?.url ?? ''
	const context = await createNdkPublishContext(ndk, ndk.signer)
	return publishLiveChatMessageWorkflow(context, { liveActivityCoord, content, relayHint })
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
