import { ChatMessageBubble } from '@/components/messages/ChatMessageBubble'
import { MessageInput } from '@/components/messages/MessageInput'
import { authStore } from '@/lib/stores/auth'
import { notificationActions } from '@/lib/stores/notifications'
import { sendChatMessage, useConversationMessages } from '@/queries/messages'
import { messageKeys } from '@/queries/queryKeyFactory'
import { useProfileName } from '@/queries/profiles'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ConversationViewLayout } from '@ui/components/messages/MessagingViews'

interface ConversationViewProps {
	/** The pubkey of the other user in the conversation */
	otherUserPubkey: string
	/** Optional callback when title changes (for sheet header updates) */
	onTitleChange?: (title: string) => void
}

/**
 * Reusable conversation view component that displays messages and allows sending
 * Can be used in sheets, dialogs, or as a standalone page component
 */
export function ConversationView({ otherUserPubkey, onTitleChange }: ConversationViewProps) {
	const { user: currentUser } = useStore(authStore)
	const queryClient = useQueryClient()
	const messagesEndRef = useRef<HTMLDivElement | null>(null)
	const [isSending, setIsSending] = useState(false)

	// Get the user's profile name for the title
	const { data: userName, isLoading: isLoadingName } = useProfileName(otherUserPubkey)
	const displayTitle = isLoadingName ? 'Messages' : userName ? userName : `${otherUserPubkey.substring(0, 8)}...`

	// Notify parent of title changes
	useEffect(() => {
		if (onTitleChange) {
			onTitleChange(displayTitle)
		}
	}, [displayTitle, onTitleChange])

	const { data: messages, isLoading, error, refetch } = useConversationMessages(otherUserPubkey)

	const scrollToBottom = () => {
		setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 0)
	}

	useEffect(() => {
		scrollToBottom()
	}, [messages])

	// Mark this conversation as seen when viewing it
	useEffect(() => {
		notificationActions.markConversationSeen(otherUserPubkey)
	}, [otherUserPubkey])

	const sendMessageMutation = useMutation({
		mutationFn: async (content: string) => {
			setIsSending(true)
			const sentEvent = await sendChatMessage(otherUserPubkey, content)
			setIsSending(false)
			if (!sentEvent) {
				throw new Error('Failed to send message')
			}
			return sentEvent
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: messageKeys.conversationMessages(currentUser?.pubkey, otherUserPubkey),
			})
			queryClient.invalidateQueries({
				queryKey: messageKeys.conversationsList(currentUser?.pubkey),
			})
		},
		onError: (err) => {
			setIsSending(false)
			console.error('Error sending message:', err)
			toast.error(`Failed to send message: ${err instanceof Error ? err.message : 'Unknown error'}`)
		},
	})

	const handleSendMessage = async (content: string) => {
		if (!otherUserPubkey) return
		await sendMessageMutation.mutateAsync(content)
	}

	return (
		<ConversationViewLayout
			isLoading={isLoading}
			errorMessage={error ? error.message : null}
			onRetry={() => refetch()}
			isEmpty={!!messages && messages.length === 0}
			messages={messages?.map((event) => (
				<ChatMessageBubble key={event.id} event={event} isCurrentUser={event.pubkey === currentUser?.pubkey} />
			))}
			endRef={(node) => {
				messagesEndRef.current = node
			}}
			input={otherUserPubkey ? <MessageInput onSendMessage={handleSendMessage} isSending={isSending} /> : null}
		/>
	)
}
