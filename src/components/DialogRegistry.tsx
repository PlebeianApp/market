import { LoginDialog } from '@/components/auth/LoginDialog'
import { QRScannerDialog } from '@/components/wallet/QRScannerDialog'
import { uiStore } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import { useMemo } from 'react'

export function DialogRegistry() {
	const { dialogs, dialogCallbacks } = useStore(uiStore)

	const activeDialog = useMemo(() => {
		if (dialogs.login) return 'login'
		if (dialogs['scan-qr']) return 'scan-qr'
		return null
	}, [dialogs])

	if (!activeDialog) return null

	const dialogConfig = {
		login: {
			content: (
				<LoginDialog
					open={true}
					onOpenChange={(open) => {
						if (!open) {
							uiStore.setState((state) => ({
								...state,
								dialogs: {
									...state.dialogs,
									login: false,
								},
							}))
						}
					}}
				/>
			),
		},
		'scan-qr': {
			content: (
				<QRScannerDialog
					open={true}
					onOpenChange={(open) => {
						if (!open) {
							uiStore.setState((state) => ({
								...state,
								dialogs: {
									...state.dialogs,
									'scan-qr': false,
								},
							}))
						}
					}}
					onScan={(data: string) => {
						const callback = dialogCallbacks?.['scan-qr']
						if (callback && typeof callback === 'function') {
							callback(data)
						}
					}}
				/>
			),
		},
	}

	const config = dialogConfig[activeDialog]

	return config.content
}
