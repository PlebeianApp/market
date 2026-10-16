import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { ShareProfileDialogView } from '@ui/components/dialogs/DialogViews'

interface ShareProfileDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	pubkey: string
	profileName?: string
}

export function ShareProfileDialog({ open, onOpenChange, pubkey, profileName }: ShareProfileDialogProps) {
	return (
		<ShareProfileDialogView
			open={open}
			onOpenChange={onOpenChange}
			npub={pubkey ? nip19.npubEncode(pubkey) : ''}
			profileName={profileName}
			onCopyResult={(copied) => (copied ? toast.success('npub copied to clipboard!') : toast.error('Failed to copy npub'))}
		/>
	)
}
