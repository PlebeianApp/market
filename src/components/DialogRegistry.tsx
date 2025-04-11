import { LoginDialog } from '@/components/auth/LoginDialog'
import { Dialog } from '@/components/ui/dialog'
import { useStore } from '@tanstack/react-store'
import { uiStore } from '@/lib/stores/ui'
import { useMemo } from 'react'

export function DialogRegistry() {
	const { dialogs } = useStore(uiStore)

	const activeDialog = useMemo(() => {
		if (dialogs.login) return 'login'
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
	}

	const config = dialogConfig[activeDialog]

	return config.content
}
