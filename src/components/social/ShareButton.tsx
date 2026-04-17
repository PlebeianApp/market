import { useState } from 'react'
import { ShareProductDialog } from '../dialogs/ShareProductDialog'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { ButtonProps } from '../shared/ButtonProps'
import { TooltipButton } from '../shared/TooltipButton'

interface ShareButtonProps extends ButtonProps {
	event: NDKEvent
	itemName?: string
}

export const ShareButton = ({ event, itemName: itemNameProp, className, onClick, onPointerDown, variant, ...props }: ShareButtonProps) => {
	const [shareDialogOpen, setShareDialogOpen] = useState(false)

	const itemName = itemNameProp ?? event.tags.find((v) => v[0] === 'title')?.[1] ?? 'Unknown'

	return (
		<>
			<TooltipButton
				variant={variant ?? 'outline'}
				size="icon"
				className={'border-foreground rounded border-2 bg-transparent hover:bg-foreground hover:text-background ' + className}
				tooltip="Share"
				{...props}
				onClick={() => setShareDialogOpen(true)}
				data-testid="share-button"
			>
				<span className="w-6 h-6 i-sharing" />
			</TooltipButton>

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
