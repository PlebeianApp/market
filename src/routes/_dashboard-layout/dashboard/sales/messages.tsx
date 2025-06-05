import { ConversationListItem, type ConversationItemData } from '@/components/messages/ConversationListItem'
import { ScrollArea } from '@/components/ui/scroll-area'
import { authStore } from '@/lib/stores/auth'
import { useConversationsList } from '@/queries/messages'
import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Loader2, MessageSquareText } from 'lucide-react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/messages')({
	component: MessagesParentComponent,
})

function MessagesParentComponent() {
	const { user: currentUser } = useStore(authStore)
	const { data: conversations, isLoading, error } = useConversationsList()
	const matchRoute = useMatchRoute()

	const isChatDetailActive = matchRoute({
		to: '/dashboard/sales/messages/$pubkey',
		fuzzy: true,
	})

	if (!currentUser) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to view your messages.</p>
			</div>
		)
	}

	// If a specific chat detail is active, render only the Outlet for it
	if (isChatDetailActive) {
		return <Outlet />
	}

	// Otherwise, render the list of conversations
	return (
		<div className="flex flex-col border bg-card rounded-md shadow-sm p-1 h-[calc(100vh-var(--header-height)-var(--page-padding)-2px)]">
			<div className="flex items-center justify-between p-3 pb-2 border-b mb-2">
				<h1 className="text-xl font-bold flex items-center">
					<MessageSquareText className="w-6 h-6 mr-2" />
					Chats
				</h1>
				{/* Placeholder for New Message button or actions */}
			</div>

			{isLoading && (
				<div className="flex flex-col justify-center items-center flex-grow">
					<Loader2 className="w-8 h-8 animate-spin text-primary" />
					<p className="ml-2 mt-2">Loading conversations...</p>
				</div>
			)}
			{error && <p className="text-destructive p-4 text-center flex-grow">Error loading conversations: {error.message}</p>}
			{!isLoading && !error && conversations?.length === 0 && (
				<div className="p-8 text-center text-muted-foreground border bg-background rounded-md min-h-[200px] flex flex-col justify-center items-center flex-grow">
					<MessageSquareText size={48} className="mb-4" />
					<p>No conversations yet.</p>
					<p className="text-sm">Your conversations will appear here.</p>
				</div>
			)}

			{!isLoading && !error && conversations && conversations.length > 0 && (
				<ScrollArea className="flex-grow">
					<div className="space-y-1.5 pr-2">
						{conversations.map((convo: ConversationItemData) => (
							<ConversationListItem key={convo.pubkey} conversation={convo} />
						))}
					</div>
				</ScrollArea>
			)}
		</div>
	)
}
