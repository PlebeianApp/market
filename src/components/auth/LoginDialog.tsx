import { NOSTR_AUTO_LOGIN, useAuth } from '@/lib/stores/auth'
import { useState } from 'react'
import { NostrConnectQR } from './NostrConnectQR'
import { PrivateKeyLogin } from './PrivateKeyLogin'
import { BunkerConnect } from './BunkerConnect'
import { hasAcceptedTerms } from '@/components/dialogs/TermsConditionsDialog'
import { uiActions } from '@/lib/stores/ui'
import { LoginDialogView } from '@ui/components/auth/LoginDialogView'

interface LoginDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
	const [enableAutoLogin, setEnableAutoLogin] = useState(localStorage.getItem(NOSTR_AUTO_LOGIN) === 'true')
	const [extensionError, setExtensionError] = useState<string | null>(null)
	const { loginWithExtension } = useAuth()

	const handleError = (error: string) => {
		console.error(error)
	}

	const handleLoginSuccess = () => {
		onOpenChange(false)
		if (!hasAcceptedTerms()) {
			uiActions.openDialog('terms')
		}
	}

	return (
		<LoginDialogView
			open={open}
			onOpenChange={onOpenChange}
			privateKeyPanel={<PrivateKeyLogin onError={handleError} onSuccess={handleLoginSuccess} />}
			nostrConnectQrPanel={<NostrConnectQR onError={handleError} onSuccess={handleLoginSuccess} />}
			bunkerPanel={<BunkerConnect onError={handleError} onSuccess={handleLoginSuccess} />}
			extensionError={extensionError}
			onConnectExtension={() => {
				setExtensionError(null)
				loginWithExtension()
					.then(() => handleLoginSuccess())
					.catch((error) => {
						console.error(error)
						setExtensionError(error.message || 'Failed to connect to extension')
					})
			}}
			autoLogin={enableAutoLogin}
			onAutoLoginChange={(enabled) => {
				setEnableAutoLogin(enabled)
				localStorage.setItem(NOSTR_AUTO_LOGIN, enabled ? 'true' : 'false')
			}}
		/>
	)
}
