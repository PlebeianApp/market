import { useState } from 'react'
import { ShareProductDialog } from '../dialogs/ShareProductDialog'
import { Button, type ButtonVariant } from '../ui/button'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

interface ShareButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent
	variant?: ButtonVariant
	itemName?: string
}

export const ShareButton = ({ event, itemName: itemNameProp, className, onClick, onPointerDown, variant, ...props }: ShareButtonProps) => {
	const [shareDialogOpen, setShareDialogOpen] = useState(false)

	const itemName = itemNameProp ?? event.tags.find((v) => v[0] === 'title')?.[1] ?? 'Unknown'

	return (
		<>
			<Button
				variant={variant ?? 'outline'}
				size="icon"
				className={'border-foreground border-2 bg-transparent hover:bg-foreground hover:text-background ' + className}
				icon={<span className="i-sharing w-6 h-6" />}
				tooltip="Share"
				{...props}
				onClick={() => setShareDialogOpen(true)}
				data-testid="share-button"
			/>

			{/* Share Dialog */}
			<ShareProductDialog
				open={shareDialogOpen}
				onOpenChange={setShareDialogOpen}
				productId={event.id}
				pubkey={event.pubkey}
				title={itemName}
			/>
		</>
	)
}
