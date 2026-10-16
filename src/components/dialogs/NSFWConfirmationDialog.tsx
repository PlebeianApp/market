import { uiActions, uiStore } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import { NSFWConfirmationDialogView } from '@ui/components/dialogs/DialogViews'

export function NSFWConfirmationDialog() {
	const { dialogs } = useStore(uiStore)

	return (
		<NSFWConfirmationDialogView
			open={dialogs['nsfw-confirmation']}
			onConfirm={() => uiActions.enableNSFWContent()}
			onCancel={() => uiActions.closeDialog('nsfw-confirmation')}
		/>
	)
}
