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
		<div className="flex items-center gap-2 p-4 border-t bg-background sticky bottom-0">
			<Textarea
				value={message}
				onChange={(e) => setMessage(e.target.value)}
				onKeyPress={handleKeyPress}
				placeholder="Type your message..."
				className="flex-grow resize-none p-2 border rounded-lg focus:ring-2 focus:ring-primary"
				rows={1} // Start with 1 row, expands with content or Shift+Enter
				disabled={isSending}
			/>
			<Button onClick={handleSend} disabled={isSending || message.trim() === ''} size="icon">
				<Send className="w-5 h-5" />
				<span className="sr-only">Send message</span>
			</Button>
		</div>
	)
}
