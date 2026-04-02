import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { V4VManager } from '@/components/v4v/V4VManager'
import { useV4VShares } from '@/queries/v4v'
import { useMemo } from 'react'

interface V4VSetupDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	userPubkey: string
	onConfirm?: () => void
}

export function V4VSetupDialog({ open, onOpenChange, userPubkey, onConfirm }: V4VSetupDialogProps) {
	// Fetch existing V4V shares (if any)
	const { data: v4vShares } = useV4VShares(userPubkey)

	// Calculate initial values from fetched shares
	const { initialShares, initialTotalPercentage } = useMemo(() => {
		if (!v4vShares || v4vShares.length === 0) {
			return { initialShares: [], initialTotalPercentage: 10 }
		}

		// Calculate total V4V percentage (sum of all share percentages)
		const totalPercentage = v4vShares.reduce((sum, share) => sum + share.percentage, 0) * 100

		// Normalize shares to sum to 1 (for the split between recipients)
		const totalSharePercentage = v4vShares.reduce((sum, share) => sum + share.percentage, 0)
		const normalizedShares = v4vShares.map((share) => ({
			...share,
			percentage: share.percentage / totalSharePercentage,
		}))

		return {
			initialShares: normalizedShares,
			initialTotalPercentage: totalPercentage,
		}
	}, [v4vShares])

	const handleSaveSuccess = () => {
		onOpenChange(false)
		if (onConfirm) {
			onConfirm()
		}
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
					<V4VManager
						userPubkey={userPubkey}
						initialShares={initialShares}
						initialTotalPercentage={initialTotalPercentage}
						onSaveSuccess={handleSaveSuccess}
						showSaveButton={true}
						saveButtonText="Confirm & Save"
						saveButtonTestId="confirm-v4v-setup-button"
						showCancelButton={true}
						onCancel={() => onOpenChange(false)}
					/>
				</div>
			</DialogContent>
		</Dialog>
	)
}
