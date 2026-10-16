import { V4VManager } from '@/components/v4v/V4VManager'
import { salesV4VConfig, salesV4VLabels, type V4VConfig, type V4VLabels } from '@/lib/v4v/labels'
import { salesV4VManagerProps } from '@/lib/v4v/sales-props'
import { deriveInitialSharesFromStored } from '@/lib/v4v/splits'
import { useV4VManager } from '@/hooks/useV4VManager'
import { useV4VShares } from '@/queries/v4v'
import { useMemo } from 'react'
import { V4VSetupDialogView } from '@ui/components/dialogs/DialogViews'

interface V4VSetupDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	userPubkey: string
	onConfirm?: () => void
}

export function V4VSetupDialog({ open, onOpenChange, userPubkey, onConfirm }: V4VSetupDialogProps) {
	const { data: v4vShares } = useV4VShares(userPubkey)
	const { initialShares, initialTotalPercentage } = useMemo(() => deriveInitialSharesFromStored(v4vShares), [v4vShares])

	const handleSaveSuccess = () => {
		onOpenChange(false)
		onConfirm?.()
	}

	// V4VManager stays dialog-agnostic; the dialog copy and buttons come in via labels/config.
	const sales = useV4VManager({ userPubkey, initialShares, initialTotalPercentage, onSaveSuccess: handleSaveSuccess })
	const labels: V4VLabels = { ...salesV4VLabels, saveButtonText: 'Confirm & Save' }
	const config: V4VConfig = { ...salesV4VConfig, showCancelButton: true, saveButtonTestId: 'confirm-v4v-setup-button' }

	return (
		<V4VSetupDialogView open={open} onOpenChange={onOpenChange}>
			<V4VManager {...salesV4VManagerProps(sales)} onCancel={() => onOpenChange(false)} labels={labels} config={config} />
		</V4VSetupDialogView>
	)
}
