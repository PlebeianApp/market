import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { useStore } from '@tanstack/react-store'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { publishShareNoteWorkflow } from '@sdk/commerce/messaging'
import { ShareProductDialogView } from '@ui/components/ShareProductDialogView'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))])
}

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

			if (!ndk.signer) {
				throw new Error('No signer available. Please log in with a signing method.')
			}

			const context = await createNdkPublishContext(ndk, ndk.signer, (event) =>
				withTimeout(ndkActions.publishEvent(event), 10000, 'Publish timeout after 10 seconds').then(() => undefined),
			)
			const sign = context.signer.sign
			await publishShareNoteWorkflow(
				{ ...context, signer: { sign: (template) => withTimeout(sign(template), 30000, 'Sign timeout - signer not responding') } },
				{ content: shareText, coordinate: `30402:${pubkey}:${productId}`, url: productUrl },
			)

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
		<ShareProductDialogView
			open={open}
			onOpenChange={onOpenChange}
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
