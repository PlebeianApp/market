import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface ShareDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent
	title?: string
	description?: string
}

export function ShareDialog({ open, onOpenChange, event, title, description }: ShareDialogProps) {
	const { isAuthenticated } = useStore(authStore)
	const [shareText, setShareText] = useState('')
	const [isPosting, setIsPosting] = useState(false)
	const [isCopied, setIsCopied] = useState(false)

	// Build the event URL
	const eventUrl =
		typeof window !== 'undefined'
			? `${window.location.origin}/u/${event.pubkey}/events/${event.id}`
			: `/u/${event.pubkey}/events/${event.id}`

	// Generate default share text when dialog opens
	useEffect(() => {
		if (open) {
			const defaultText = title
				? `Check out "${title}" on Plebeian!

${eventUrl}

#plebeian`
				: `Check out this Nostr event!

${eventUrl}

#plebeian`
			setShareText(defaultText)
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
			const ndk = ndkActions.getNDK()
			if (!ndk) {
				throw new Error('NDK not initialized')
			}

			// Check if we have a signer
			if (!ndk.signer) {
				throw new Error('No signer available. Please log in with a signing method.')
			}

			// Create kind 1 event (text note)
			const eventToPost = new NDKEvent(ndk)
			eventToPost.kind = 1
			eventToPost.content = shareText

			// Add tags for the event reference and discoverability
			eventToPost.tags = [
				['e', event.id], // Reference to the original event
				['p', event.pubkey], // Original author
				['t', 'plebeian'], // Hashtag for discoverability
			]

			// Sign the event with timeout
			const signPromise = eventToPost.sign()
			const signTimeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Sign timeout - signer not responding')), 30000),
			)
			await Promise.race([signPromise, signTimeoutPromise])

			// Publish with timeout
			const publishPromise = ndkActions.publishEvent(eventToPost)
			const publishTimeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Publish timeout after 10 seconds')), 10000),
			)
			await Promise.race([publishPromise, publishTimeoutPromise])

			toast.success('Posted to Nostr successfully!')
			onOpenChange(false)
		} catch (error) {
			console.error('Failed to post to Nostr:', error)
			const message = error instanceof Error ? error.message : 'Failed to post to Nostr'
			toast.error(message)
		} finally {
			setIsPosting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-x-hidden overflow-y-auto bg-white">
				<DialogHeader>
					<DialogTitle>Share Event</DialogTitle>
					<DialogDescription id="share-dialog-description">Share this event with others or post it to your Nostr feed.</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4 overflow-x-hidden">
					{/* Event Info */}
					{title && description && (
						<div className="space-y-2">
							<h3 className="font-semibold">{title}</h3>
							<p className="text-sm text-muted-foreground">{description}</p>
						</div>
					)}

					{isAuthenticated && (
						<div className="space-y-2">
							<label htmlFor="share-text" className="text-sm font-medium text-gray-700">
								Content to post to Nostr
							</label>
							<Textarea
								id="share-text"
								aria-describedby="share-dialog-description"
								value={shareText}
								onChange={(e) => setShareText(e.target.value)}
								rows={8}
								className="resize-none break-words whitespace-pre-wrap w-full overflow-wrap-anywhere"
								placeholder="Write something about this event..."
							/>
						</div>
					)}

					<div className="flex gap-2 flex-wrap">
						<Button variant="outline" onClick={handleCopyUrl} className="shrink-0">
							{isCopied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
							{isCopied ? 'Copied!' : 'Copy URL'}
						</Button>

						{isAuthenticated && (
							<Button
								onClick={handlePostToNostr}
								disabled={isPosting || !shareText.trim()}
								className="flex-1 flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/90 text-white"
							>
								<span className="i-send-message w-4 h-4" />
								{isPosting ? 'Posting...' : 'Post to Nostr'}
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
