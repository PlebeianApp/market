import { useRef, useEffect, useState, useCallback } from 'react'
import { Send, MessageCircle, ChevronDown } from 'lucide-react'
import { useLiveChatMessages, useLiveActivity } from '@/queries/liveChat'
import { usePublishLiveChatMessageMutation } from '@/publish/liveChat'
import { deriveLiveActivityStatus, type LiveActivityStatus } from '@/lib/nip53'
import { getAuctionId } from '@/queries/auctions'
import { getAuctionStartAt, getAuctionMaxEndAt } from '@/lib/auctionSettlement'
import { LiveChatMessageBubble } from './LiveChatMessage'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

interface LiveChatPanelProps {
	auctionEvent: NDKEvent
}

function getInputPlaceholder(status: LiveActivityStatus): string {
	switch (status) {
		case 'planned':
			return 'Chat opens when the auction starts...'
		case 'ended':
			return 'Auction has ended'
		case 'live':
			return 'Type a message...'
	}
}

export function LiveChatPanel({ auctionEvent }: LiveChatPanelProps) {
	const { user } = useStore(authStore)
	const dTag = getAuctionId(auctionEvent)

	const startsAt = getAuctionStartAt(auctionEvent)
	const maxEndAt = getAuctionMaxEndAt(auctionEvent)
	const status = deriveLiveActivityStatus(startsAt, maxEndAt)
	const isLive = status === 'live'
	const canChat = isLive

	// Poll faster (15s) while planned so the live chat activates promptly
	// when the auction starts, instead of waiting up to 60s.
	const liveActivityRefetchMs = status === 'planned' ? 15_000 : 60_000
	const liveActivityQuery = useLiveActivity(auctionEvent, { refetchInterval: liveActivityRefetchMs })
	const liveActivity = liveActivityQuery.data
	const liveActivityCoord = liveActivity?.coord ?? ''

	const chatQuery = useLiveChatMessages(liveActivityCoord, isLive)
	const messages = chatQuery.data ?? []

	const sendMessageMutation = usePublishLiveChatMessageMutation()
	const [input, setInput] = useState('')
	const chatContainerRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const [isStuckToBottom, setIsStuckToBottom] = useState(true)
	const [isNearBottom, setIsNearBottom] = useState(true)

	const scrollToBottom = useCallback(() => {
		const container = chatContainerRef.current
		if (!container) return
		container.scrollTop = container.scrollHeight
	}, [])

	const handleScrollToBottom = useCallback(() => {
		scrollToBottom()
		setIsStuckToBottom(true)
		setIsNearBottom(true)
	}, [scrollToBottom])

	// Track whether user is near the bottom on every scroll
	const handleScroll = useCallback(() => {
		const container = chatContainerRef.current
		if (!container) return
		const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
		setIsNearBottom(nearBottom)
		setIsStuckToBottom(nearBottom)
	}, [])

	// Auto-scroll when new messages arrive AND we're stuck to bottom
	useEffect(() => {
		if (isStuckToBottom && !isNearBottom) {
			// If we are logically "stuck" but the check says we aren't near it yet (race condition),
			// or if we just added messages and are still at bottom, ensure we scroll.
			// Actually, simpler: if we are stuck, force scroll.
			requestAnimationFrame(scrollToBottom)
		} else if (isStuckToBottom && isNearBottom) {
			// Already at bottom
			requestAnimationFrame(scrollToBottom)
		}
	}, [messages.length, isStuckToBottom, isNearBottom, scrollToBottom])

	// Initial scroll to bottom once messages first load
	useEffect(() => {
		scrollToBottom()
	}, [liveActivityCoord, scrollToBottom])

	// Keep input focused after sending
	useEffect(() => {
		if (!sendMessageMutation.isPending && !sendMessageMutation.isSuccess && !sendMessageMutation.isError) {
			return
		}
		if (sendMessageMutation.isSuccess) {
			setTimeout(() => inputRef.current?.focus(), 0)
		}
	}, [sendMessageMutation.status])

	if (!liveActivity) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
				<MessageCircle className="h-8 w-8 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">Live chat not available for this auction</p>
			</div>
		)
	}

	const handleSend = () => {
		const trimmed = input.trim()
		if (!trimmed || sendMessageMutation.isPending || !liveActivityCoord || !canChat) return
		sendMessageMutation.mutate({ liveActivityCoord, content: trimmed }, { onSuccess: () => setInput('') })
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	return (
		<div className="relative flex h-full flex-col bg-white">
			<div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
				<div className="flex items-center gap-2">
					<div className={`h-2 w-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-zinc-300'}`} />
					<span className="text-sm font-medium text-zinc-700">Live Chat</span>
				</div>
				<span className="text-xs text-zinc-400">{messages.length} messages</span>
			</div>

			<div ref={chatContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
						<p className="text-sm text-zinc-400">
							{isLive ? 'No messages yet. Be the first!' : 'Messages will appear here during the auction.'}
						</p>
					</div>
				) : (
					<div className="divide-y divide-zinc-100">
						{messages.map((msg) => (
							<LiveChatMessageBubble key={msg.id} message={msg} />
						))}
					</div>
				)}
			</div>

			{/* Floating Scroll to Bottom Button */}
			<Button
				variant="outline"
				size="sm"
				onClick={handleScrollToBottom}
				className={cn(
					'absolute bottom-16 mb-2 self-center shadow-sm rounded-full border-none transition-opacity',
					isNearBottom ? 'opacity-0' : 'opacity-100',
				)}
			>
				<ChevronDown className="mr-1 h-4 w-4" />
				Newest Messages
			</Button>

			{user ? (
				<div className="border-t border-zinc-200 p-3">
					<div className="flex gap-2">
						<input
							ref={inputRef}
							type="text"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={getInputPlaceholder(status)}
							disabled={!canChat || sendMessageMutation.isPending}
							className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:opacity-50 disabled:cursor-not-allowed"
						/>
						<Button size="sm" onClick={handleSend} disabled={!canChat || !input.trim() || sendMessageMutation.isPending}>
							<Send className="h-4 w-4" />
						</Button>
					</div>
				</div>
			) : (
				<div className="border-t border-muted-foreground p-4 my-2 text-center">
					<p className="text-xs text-muted-foreground">Log in to join the chat</p>
				</div>
			)}
		</div>
	)
}
