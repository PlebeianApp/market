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

interface ShareProductDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	productId: string
	pubkey: string
	title: string
}

export function ShareProductDialog({ open, onOpenChange, productId, pubkey, title }: ShareProductDialogProps) {
	const { isAuthenticated } = useStore(authStore)
	const [shareText, setShareText] = useState('')
	const [isPosting, setIsPosting] = useState(false)
	const [isCopied, setIsCopied] = useState(false)

	// Build the product URL
	const productUrl = typeof window !== 'undefined' ? `${window.location.origin}/products/${productId}` : `/products/${productId}`

	// Generate default share text when dialog opens
	useEffect(() => {
		if (open) {
			const defaultText = `Check out "${title}" on Plebeian!

${productUrl}

#plebeian`
			setShareText(defaultText)
			setIsCopied(false)
		}
	}, [open, title, productUrl])

	const handleCopyUrl = async () => {
		try {
			await navigator.clipboard.writeText(productUrl)
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
			const event = new NDKEvent(ndk)
			event.kind = 1
			event.content = shareText

			// Add tags for the product reference and discoverability
			event.tags = [
				['a', `30402:${pubkey}:${productId}`], // Reference to the product event (kind:pubkey:d-tag)
				['r', productUrl], // Reference to the product URL
				['t', 'plebeian'], // Hashtag for discoverability
			]

			// Sign the event with timeout
			const signPromise = event.sign()
			const signTimeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Sign timeout - signer not responding')), 30000)
			)
			await Promise.race([signPromise, signTimeoutPromise])

			// Publish with timeout
			const publishPromise = event.publish()
			const publishTimeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Publish timeout after 10 seconds')), 10000)
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
			<DialogContent className="sm:max-w-[40em] max-w-[calc(100%-2rem)] max-h-[90vh] overflow-x-hidden overflow-y-auto bg-white">
				<DialogHeader>
					<DialogTitle>Share Product</DialogTitle>
					<DialogDescription>Share this product with others or post it to your Nostr feed.</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{isAuthenticated && (
						<div className="space-y-2">
							<label htmlFor="share-text" className="text-sm font-medium text-gray-700">
								Post content
							</label>
							<Textarea
								id="share-text"
								value={shareText}
								onChange={(e) => setShareText(e.target.value)}
								rows={14}
								className="resize-none break-all overflow-wrap-anywhere"
								placeholder="Write something about this product..."
							/>
						</div>
					)}

					<div className="flex gap-2">
						<Button variant="tertiary" onClick={handleCopyUrl} className="shrink-0">
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
