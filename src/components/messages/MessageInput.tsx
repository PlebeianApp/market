import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'
import { useState } from 'react'

interface MessageInputProps {
	onSendMessage: (content: string) => Promise<void>
	isSending: boolean
}

export function MessageInput({ onSendMessage, isSending }: MessageInputProps) {
	const [message, setMessage] = useState('')

	const handleSend = async () => {
		if (message.trim() === '') return
		await onSendMessage(message.trim())
		setMessage('') // Clear input after sending
	}

	const handleKeyPress = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault() // Prevent newline on Enter
			handleSend()
		}
	}

	return (
		<div className="flex-wrap items-center gap-2 p-4 border-t bg-background sticky bottom-0">
			<div className="relative w-full">
				<Textarea
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyPress={handleKeyPress}
					placeholder="Type your message..."
					className="w-full flex-grow resize-none p-2 pr-12 border rounded-lg focus:ring-2 focus:ring-primary"
					rows={1}
					disabled={isSending}
				/>
				<Button
					onClick={handleSend}
					disabled={isSending || message.trim() === ''}
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
