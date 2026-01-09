import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QRCode } from '@/components/ui/qr-code'
import { nip19 } from 'nostr-tools'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface ShareProfileDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	pubkey: string
	profileName?: string
}

export function ShareProfileDialog({ open, onOpenChange, pubkey, profileName }: ShareProfileDialogProps) {
	const [isCopied, setIsCopied] = useState(false)

	const npub = pubkey ? nip19.npubEncode(pubkey) : ''

	const handleCopyNpub = async () => {
		try {
			await navigator.clipboard.writeText(npub)
			setIsCopied(true)
			toast.success('npub copied to clipboard!')
			setTimeout(() => setIsCopied(false), 2000)
		} catch (error) {
			console.error('Failed to copy npub:', error)
			toast.error('Failed to copy npub')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] bg-white">
				<DialogHeader>
					<DialogTitle>Share Profile</DialogTitle>
					<DialogDescription>
						{profileName ? `Share ${profileName}'s profile` : 'Share this profile'} with others using the QR code or copy the npub.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col items-center gap-6 py-4">
					<QRCode value={npub} size={200} showBorder={false} />

					<div className="w-full space-y-2">
						<p className="text-xs text-gray-500 text-center">npub</p>
						<div className="flex items-center gap-2">
							<code className="flex-1 p-2 bg-gray-100 rounded text-xs break-all select-all">{npub}</code>
							<Button variant="tertiary" size="icon" onClick={handleCopyNpub} className="shrink-0">
								{isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
