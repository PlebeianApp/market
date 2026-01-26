import { LoginDialog } from '@/components/auth/LoginDialog'
import { QRScannerDialog } from '@/components/wallet/QRScannerDialog'
import { V4VSetupDialog } from '@/components/dialogs/V4VSetupDialog'
import { TermsConditionsDialog } from '@/components/dialogs/TermsConditionsDialog'
import { NSFWConfirmationDialog } from '@/components/dialogs/NSFWConfirmationDialog'
import { uiStore } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import { useMemo } from 'react'
import { authStore } from '@/lib/stores/auth'

export function DialogRegistry() {
	const { dialogs, dialogCallbacks } = useStore(uiStore)
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	const activeDialog = useMemo(() => {
		if (dialogs.login) return 'login'
		if (dialogs['scan-qr']) return 'scan-qr'
		if (dialogs['v4v-setup']) return 'v4v-setup'
		if (dialogs.terms) return 'terms'
		if (dialogs['nsfw-confirmation']) return 'nsfw-confirmation'
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
		'v4v-setup': {
			content: (
				<V4VSetupDialog
					open={true}
					onOpenChange={(open) => {
						if (!open) {
							uiStore.setState((state) => ({
								...state,
								dialogs: {
									...state.dialogs,
									'v4v-setup': false,
								},
							}))
						}
					}}
					userPubkey={userPubkey}
					onConfirm={() => {
						const callback = dialogCallbacks?.['v4v-setup']
						if (callback && typeof callback === 'function') {
							callback()
						}
					}}
				/>
			),
		},
		terms: {
			content: (
				<TermsConditionsDialog
					open={true}
					onOpenChange={(open) => {
						if (!open) {
							uiStore.setState((state) => ({
								...state,
								dialogs: {
									...state.dialogs,
									terms: false,
								},
							}))
						}
					}}
					onAccept={() => {
						const callback = dialogCallbacks?.terms
						if (callback && typeof callback === 'function') {
							callback()
						}
					}}
				/>
			),
		},
		'nsfw-confirmation': {
			content: <NSFWConfirmationDialog />,
		},
	}

	const config = dialogConfig[activeDialog]

	return config.content
}
