import { useState, type ReactNode } from 'react'
import { Loader2, MessageSquareText, Send } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Card } from '../../primitives/card'
import { Textarea } from '../../primitives/textarea'
import { UiLink } from '../../provider/UiProvider'

export interface MessageInputViewProps {
	onSendMessage: (content: string) => Promise<void>
	isSending: boolean
	isLoggedIn: boolean
}

export function MessageInputView({ onSendMessage, isSending, isLoggedIn }: MessageInputViewProps) {
	const [message, setMessage] = useState('')

	const handleSend = async () => {
		if (message.trim() === '') return
		await onSendMessage(message.trim())
		setMessage('')
	}

	return (
		<div className="flex-wrap items-center gap-2 p-4 border-t bg-background sticky bottom-0">
			<div className="relative w-full">
				<Textarea
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyPress={(event) => {
						// Enter sends; Shift+Enter inserts a newline.
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault()
							handleSend()
						}
					}}
					placeholder={isLoggedIn ? 'Type your message...' : 'Log in to send messages'}
					className="w-full flex-grow resize-none p-2 pr-12 border rounded-lg focus:ring-2 focus:ring-primary"
					rows={1}
					disabled={isSending || !isLoggedIn}
				/>
				<Button
					onClick={handleSend}
					disabled={isSending || !isLoggedIn || message.trim() === ''}
					size="icon"
					className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7"
				>
					<Send className="w-4 h-4" />
					<span className="sr-only">Send message</span>
				</Button>
			</div>
		</div>
	)
}

export interface ConversationListItemViewProps {
	href: string
	userCard: ReactNode
	lastMessageAt: number | undefined
	lastMessageSnippet: string
	unseenCount: number
	isMobile: boolean
	/** The conversation is the one currently open. */
	isActive: boolean
}

export function ConversationListItemView({
	href,
	userCard,
	lastMessageAt,
	lastMessageSnippet,
	unseenCount,
	isMobile,
	isActive,
}: ConversationListItemViewProps) {
	const dateElement = lastMessageAt && (
		<span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(lastMessageAt * 1000).toLocaleString()}</span>
	)

	return (
		<UiLink href={href} className={isActive ? 'block w-full bg-muted/20 rounded-lg' : 'block w-full'}>
			<Card className="p-4 hover:bg-muted/50 transition-colors relative">
				{unseenCount > 0 && (
					<div className="absolute top-2 right-2 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-bold text-white bg-pink-500 rounded-full">
						{unseenCount > 99 ? '99+' : unseenCount}
					</div>
				)}

				<div className="flex items-center gap-4">
					<div className="p-2 bg-muted rounded-full">
						<MessageSquareText className="h-6 w-6 text-muted-foreground" />
					</div>

					<div className="flex-1 flex flex-col gap-1">
						<div className="flex items-center justify-between">
							{userCard}
							{!isMobile && dateElement}
						</div>
						<div className="pr-12">
							<p className={`text-sm break-words ${unseenCount > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
								{lastMessageSnippet}
							</p>
						</div>
						{isMobile && <div className="self-end mt-1">{dateElement}</div>}
					</div>
				</div>
			</Card>
		</UiLink>
	)
}

export interface ConversationViewLayoutProps {
	isLoading: boolean
	errorMessage: string | null
	onRetry: () => void
	isEmpty: boolean
	/** Rendered message bubbles, oldest first. */
	messages: ReactNode
	/** Scroll anchor kept below the last message. */
	endRef: (node: HTMLDivElement | null) => void
	input: ReactNode
}

export function ConversationViewLayout({
	isLoading,
	errorMessage,
	onRetry,
	isEmpty,
	messages,
	endRef,
	input,
}: ConversationViewLayoutProps) {
	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
				{isLoading && (
					<div className="flex justify-center items-center h-full">
						<Loader2 className="w-8 h-8 animate-spin text-primary" />
						<p className="ml-2">Loading messages...</p>
					</div>
				)}
				{errorMessage !== null && (
					<div className="text-center text-destructive">
						<p>Error loading messages: {errorMessage}</p>
						<Button onClick={onRetry} className="mt-2">
							Try Again
						</Button>
					</div>
				)}
				{!isLoading && errorMessage === null && isEmpty && (
					<div className="text-center text-muted-foreground pt-10">
						<p>No messages yet. Start the conversation!</p>
					</div>
				)}
				{!isLoading && errorMessage === null && messages}
				<div ref={endRef} />
			</div>

			{input && <div className="flex-shrink-0 border-t bg-background">{input}</div>}
		</div>
	)
}
