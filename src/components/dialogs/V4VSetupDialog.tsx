import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { V4VManager } from '@/components/v4v/V4VManager'
import { useV4VManager } from '@/hooks/useV4VManager'
import { toast } from 'sonner'

interface V4VSetupDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	userPubkey: string
	onConfirm?: () => void
}

export function V4VSetupDialog({ open, onOpenChange, userPubkey, onConfirm }: V4VSetupDialogProps) {
	const { saveShares, localShares, totalV4VPercentage } = useV4VManager({
		userPubkey,
		onSaveSuccess: () => {
			onOpenChange(false)
			if (onConfirm) {
				onConfirm()
			}
		},
	})

	const handleConfirm = async () => {
		if (totalV4VPercentage === 0 || localShares.length === 0) {
			toast.error('Please set up V4V shares before confirming')
			return
		}

		await saveShares()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Set up Value for Value (V4V)</DialogTitle>
					<DialogDescription>
						Configure how much of your sales will be shared with the community. This helps support the platform and other contributors.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					<V4VManager userPubkey={userPubkey} />

					{/* Dialog actions */}
					<div className="flex justify-end gap-2 mt-6 pt-4 border-t">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button onClick={handleConfirm} disabled={totalV4VPercentage === 0 || localShares.length === 0}>
							'Confirm & Save'
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
