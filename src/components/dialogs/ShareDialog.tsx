import { authStore } from '@/lib/stores/auth'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ShareEventNoteInput } from '@sdk/commerce/messaging'
import { ShareEventDialogView } from '@ui/components/dialogs/DialogViews'

interface ShareDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent
	title?: string
	description?: string
	/** Signs and publishes the share note; wired by the caller to the publish layer. */
	onPost: (input: ShareEventNoteInput) => Promise<unknown>
}

export function ShareDialog({ open, onOpenChange, event, title, description, onPost }: ShareDialogProps) {
	const { isAuthenticated } = useStore(authStore)
	const [shareText, setShareText] = useState('')
	const [isPosting, setIsPosting] = useState(false)
	const [isCopied, setIsCopied] = useState(false)

	const eventUrl =
		typeof window !== 'undefined'
			? `${window.location.origin}/u/${event.pubkey}/events/${event.id}`
			: `/u/${event.pubkey}/events/${event.id}`

	useEffect(() => {
		if (open) {
			const intro = title ? `Check out "${title}" on Plebeian!` : 'Check out this Nostr event!'
			setShareText(`${intro}\n\n${eventUrl}\n\n#plebeian`)
			setIsCopied(false)
		}
	}, [open, title, eventUrl])

	const handleCopyUrl = async () => {
		try {
			await navigator.clipboard.writeText(eventUrl)
			setIsCopied(true)
			toast.success('URL copied to clipboard!')
			setTimeout(() => setIsCopied(false), 2000)
		} catch (error) {
			console.error('Failed to copy URL:', error)
			toast.error('Failed to copy URL')
		}
	}

	const handlePostToNostr = async () => {
		if (!isAuthenticated) {
			toast.error('You must be logged in to post to Nostr')
			return
		}

		setIsPosting(true)
		try {
			await onPost({ content: shareText, eventId: event.id, authorPubkey: event.pubkey })

			toast.success('Posted to Nostr successfully!')
			onOpenChange(false)
		} catch (error) {
			console.error('Failed to post to Nostr:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to post to Nostr')
		} finally {
			setIsPosting(false)
		}
	}

	return (
		<ShareEventDialogView
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={description}
			canPost={isAuthenticated}
			shareText={shareText}
			onShareTextChange={setShareText}
			isCopied={isCopied}
			isPosting={isPosting}
			onCopyUrl={handleCopyUrl}
			onPost={handlePostToNostr}
		/>
	)
}
