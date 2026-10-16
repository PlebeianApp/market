import { useAuth, authActions } from '@/lib/stores/auth'
import { MigratePrivateKeyDialogView } from '@ui/components/auth/AuthKeyDialogs'

export function MigratePrivateKeyDialog() {
	const { needsMigration } = useAuth()

	return (
		<MigratePrivateKeyDialogView
			open={needsMigration}
			minPasswordLength={process.env.NODE_ENV === 'production' ? 8 : 0}
			onEncrypt={(password) => authActions.migrateToEncryptedKey(password)}
		/>
	)
}
