import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { V4VManager } from '@/components/v4v/V4VManager'
import { salesV4VConfig, salesV4VLabels, type V4VConfig, type V4VLabels } from '@/lib/v4v/labels'
import { salesV4VManagerProps } from '@/lib/v4v/sales-props'
import { deriveInitialSharesFromStored } from '@/lib/v4v/splits'
import { useV4VManager } from '@/hooks/useV4VManager'
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

	// Derive editor boot values from stored shares (shared helper, no duplication).
	const { initialShares, initialTotalPercentage } = useMemo(() => deriveInitialSharesFromStored(v4vShares), [v4vShares])

	const handleSaveSuccess = () => {
		onOpenChange(false)
		if (onConfirm) {
			onConfirm()
		}
	}

	// The sales / "all products" adapter, with dialog-specific copy + config
	// (confirm-and-save button, cancel button). The agnostic V4VManager receives
	// this via props — it does not know it is inside a dialog.
	const sales = useV4VManager({ userPubkey, initialShares, initialTotalPercentage, onSaveSuccess: handleSaveSuccess })

	const labels: V4VLabels = { ...salesV4VLabels, saveButtonText: 'Confirm & Save' }
	const config: V4VConfig = { ...salesV4VConfig, showCancelButton: true, saveButtonTestId: 'confirm-v4v-setup-button' }

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
					<V4VManager {...salesV4VManagerProps(sales)} onCancel={() => onOpenChange(false)} labels={labels} config={config} />
				</div>
			</DialogContent>
		</Dialog>
	)
}
