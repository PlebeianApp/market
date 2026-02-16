import { UserWithAvatar } from '@/components/UserWithAvatar'
import { ChatMessageBubble } from '@/components/messages/ChatMessageBubble'
import { MessageInput } from '@/components/messages/MessageInput'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { notificationActions } from '@/lib/stores/notifications'
import { sendChatMessage, useConversationMessages } from '@/queries/messages'
import { messageKeys } from '@/queries/queryKeyFactory'
import { useProfileName } from '@/queries/profiles'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface ConversationViewProps {
	/** The pubkey of the other user in the conversation */
	otherUserPubkey: string
	/** Optional callback when title changes (for sheet header updates) */
	onTitleChange?: (title: string) => void
	/** Whether to show the user avatar header (disable for sheets that show it separately) */
	showHeader?: boolean
}

/**
 * Reusable conversation view component that displays messages and allows sending
 * Can be used in sheets, dialogs, or as a standalone page component
 */
export function ConversationView({ otherUserPubkey, onTitleChange, showHeader = true }: ConversationViewProps) {
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
			alert(`Failed to send message: ${err instanceof Error ? err.message : 'Unknown error'}`)
		},
	})

	const handleSendMessage = async (content: string) => {
		if (!otherUserPubkey) return
		await sendMessageMutation.mutateAsync(content)
	}

	return (
		<div data-testid="conversation-view" className="flex flex-col h-full">
			{/* Optional Header */}
			{showHeader && (
				<div className="flex-shrink-0 border-b bg-background p-4">
					<UserWithAvatar pubkey={otherUserPubkey} size="md" showBadge={true} disableLink={false} />
				</div>
			)}

			{/* Messages Area */}
			<div data-testid="messages-list" className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
				{isLoading && (
					<div className="flex justify-center items-center h-full">
						<Loader2 className="w-8 h-8 animate-spin text-primary" />
						<p className="ml-2">Loading messages...</p>
					</div>
				)}
				{error && (
					<div className="text-center text-destructive">
						<p>Error loading messages: {error.message}</p>
						<Button onClick={() => refetch()} className="mt-2">
							Try Again
						</Button>
					</div>
				)}
				{!isLoading && !error && messages && messages.length === 0 && (
					<div data-testid="empty-state" className="text-center text-muted-foreground pt-10">
						<p>No messages yet. Start the conversation!</p>
					</div>
				)}
				{!isLoading &&
					!error &&
					messages?.map((event) => <ChatMessageBubble key={event.id} event={event} isCurrentUser={event.pubkey === currentUser?.pubkey} />)}
				<div ref={messagesEndRef} />
			</div>

			{/* Input Area */}
			{otherUserPubkey && (
				<div className="flex-shrink-0 border-t bg-background">
					<MessageInput onSendMessage={handleSendMessage} isSending={isSending} />
				</div>
			)}
		</div>
	)
}
