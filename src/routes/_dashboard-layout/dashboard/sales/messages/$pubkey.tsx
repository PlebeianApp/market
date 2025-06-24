import { UserWithAvatar } from '@/components/UserWithAvatar'
import { ChatMessageBubble } from '@/components/messages/ChatMessageBubble'
import { MessageInput } from '@/components/messages/MessageInput'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { sendChatMessage, useConversationMessages } from '@/queries/messages'
import { messageKeys } from '@/queries/queryKeyFactory'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/messages/$pubkey')({
	component: ConversationDetailComponent,
})

function ConversationDetailComponent() {
	const { pubkey: otherUserPubkey } = Route.useParams()
	const { user: currentUser } = useStore(authStore)
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const messagesEndRef = useRef<HTMLDivElement | null>(null)
	const [isSending, setIsSending] = useState(false)
	useDashboardTitle('Messages')

	const { data: messages, isLoading, error, refetch } = useConversationMessages(otherUserPubkey)

	const scrollToBottom = () => {
		setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 0) // Use auto for instant scroll on load
	}

	useEffect(() => {
		scrollToBottom()
	}, [messages])

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
			// scrollToBottom() // Let useEffect handle scroll on new messages
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

	const handleGoBack = () => {
		navigate({ to: '/dashboard/sales/messages/' })
	}

	return (
		<div className="flex flex-col h-[calc(100vh-var(--header-height)-var(--page-padding)-2px)] bg-card border rounded-md shadow-sm">
			{/* Header */}
			<div className="flex items-center p-3 border-b sticky top-0 bg-card z-10">
				<Button variant="ghost" size="icon" onClick={handleGoBack} className="mr-2">
					<ArrowLeft className="w-5 h-5" />
				</Button>
				{otherUserPubkey && <UserWithAvatar pubkey={otherUserPubkey} showBadge={true} size="md" />}
			</div>

			{/* Messages Area */}
			<div className="flex-grow overflow-y-auto p-4 space-y-4">
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
					<div className="text-center text-muted-foreground pt-10">
						<p>No messages yet. Start the conversation!</p>
					</div>
				)}
				{!isLoading &&
					!error &&
					messages?.map((event) => <ChatMessageBubble key={event.id} event={event} isCurrentUser={event.pubkey === currentUser?.pubkey} />)}
				<div ref={messagesEndRef} />
			</div>

			{/* Input Area */}
			{otherUserPubkey && <MessageInput onSendMessage={handleSendMessage} isSending={isSending} />}
		</div>
	)
}
