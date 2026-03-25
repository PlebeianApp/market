import { useState } from 'react'
import { ShareProductDialog } from '../dialogs/ShareProductDialog'
import { Button } from '../ui/button'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

interface ShareButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	event: NDKEvent
	itemName?: string
}

export const ShareButton = ({ event, itemName: itemNameProp, className, onClick, onPointerDown, ...props }: ShareButtonProps) => {
	const [shareDialogOpen, setShareDialogOpen] = useState(false)

	const itemName = itemNameProp ?? event.tags.find((v) => v[0] === 'title')?.[1] ?? 'Unknown'

	return (
		<>
			<Button
				variant="primary"
				size="icon"
				className="bg-white/10 hover:bg-white/20"
				icon={<span className="i-sharing w-6 h-6" />}
				tooltip="Share"
				{...props}
				onClick={() => setShareDialogOpen(true)}
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
