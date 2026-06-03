import { useRef, useEffect, useState } from 'react'
import { Send, MessageCircle } from 'lucide-react'
import { useLiveChatMessages, useLiveActivity } from '@/queries/liveChat'
import { usePublishLiveChatMessageMutation } from '@/publish/liveChat'
import { deriveLiveActivityStatus } from '@/lib/nip53'
import { getAuctionId } from '@/queries/auctions'
import { getAuctionStartAt, getAuctionMaxEndAt } from '@/lib/auctionSettlement'
import { LiveChatMessageBubble } from './LiveChatMessage'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { Button } from './ui/button'

interface LiveChatPanelProps {
	auctionEvent: NDKEvent
}

export function LiveChatPanel({ auctionEvent }: LiveChatPanelProps) {
	const { user } = useStore(authStore)
	const dTag = getAuctionId(auctionEvent)

	const liveActivityQuery = useLiveActivity(auctionEvent)
	const liveActivity = liveActivityQuery.data
	const liveActivityCoord = liveActivity?.coord ?? ''

	const startsAt = getAuctionStartAt(auctionEvent)
	const maxEndAt = getAuctionMaxEndAt(auctionEvent)
	const status = deriveLiveActivityStatus(startsAt, maxEndAt)
	const isLive = status === 'live'

	const chatQuery = useLiveChatMessages(liveActivityCoord, isLive)
	const messages = chatQuery.data ?? []

	const sendMessageMutation = usePublishLiveChatMessageMutation()
	const [input, setInput] = useState('')
	const messagesEndRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages.length])

	if (!liveActivity) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
				<MessageCircle className="h-8 w-8 text-zinc-300" />
				<p className="text-sm text-zinc-400">Live chat not available for this auction</p>
			</div>
		)
	}

	const handleSend = () => {
		const trimmed = input.trim()
		if (!trimmed || sendMessageMutation.isPending || !liveActivityCoord) return
		sendMessageMutation.mutate({ liveActivityCoord, content: trimmed }, { onSuccess: () => setInput('') })
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	return (
		<div className="flex h-full flex-col border-l border-zinc-200 bg-white">
			<div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
				<div className="flex items-center gap-2">
					<div className={`h-2 w-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-zinc-300'}`} />
					<span className="text-sm font-medium text-zinc-700">Live Chat</span>
				</div>
				<span className="text-xs text-zinc-400">{messages.length} messages</span>
			</div>

			<div className="flex-1 overflow-y-auto">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
						<p className="text-sm text-zinc-400">No messages yet. Be the first!</p>
					</div>
				) : (
					<div className="divide-y divide-zinc-100">
						{messages.map((msg) => (
							<LiveChatMessageBubble key={msg.id} message={msg} />
						))}
					</div>
				)}
				<div ref={messagesEndRef} />
			</div>

			{user ? (
				<div className="border-t border-zinc-200 p-3">
					<div className="flex gap-2">
						<input
							type="text"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Type a message..."
							disabled={sendMessageMutation.isPending}
							className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:opacity-50"
						/>
						<Button size="sm" onClick={handleSend} disabled={!input.trim() || sendMessageMutation.isPending}>
							<Send className="h-4 w-4" />
						</Button>
					</div>
				</div>
			) : (
				<div className="border-t border-zinc-200 p-3 text-center">
					<p className="text-xs text-zinc-400">Log in to join the chat</p>
				</div>
			)}
		</div>
	)
}
