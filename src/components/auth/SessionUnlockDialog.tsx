import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, authActions } from '@/lib/stores/auth'
import { hasLegacyPlaintextSession } from '@/lib/nostr/session-vault'
import { Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'

/**
 * Session unlock prompt (ADR-0008 B-3). Shown at boot when a legacy plaintext
 * NIP-46 session pair or an encrypted vault exists. Unlocking either wraps the
 * legacy pair into the vault (then deletes the plaintext) or unwraps the vault
 * and rehydrates the NostrConnectSigner. Refusal discards the persisted
 * session entirely — an intentional, user-visible forced re-login; plaintext
 * is never silently retained.
 *
 * Two distinct flows (Gate 2.5): the LEGACY-MIGRATION path has no prior
 * passphrase — the user is CHOOSING one that will encrypt the migrated
 * session, so a confirmation field guards against a typo locking them out of
 * the session forever. The VAULTED path unlocks with the existing passphrase
 * (single field; a wrong passphrase merely fails closed and can be retried).
 */
export function SessionUnlockDialog() {
	const { needsSessionUnlock, isAuthenticating } = useAuth()
	const [passphrase, setPassphrase] = useState('')
	const [confirmation, setConfirmation] = useState('')
	const [error, setError] = useState('')

	if (!needsSessionUnlock) return null

	// Snapshot at render: the legacy pair still present means this is the
	// migrate-on-unlock flow (choose a NEW passphrase + confirm it).
	const isLegacyMigration = hasLegacyPlaintextSession()
	const confirmationMismatch = isLegacyMigration && confirmation !== passphrase

	const handleUnlock = async () => {
		if (!passphrase) {
			setError('Please enter your session passphrase')
			return
		}
		if (confirmationMismatch) {
			setError('Passphrases do not match')
			return
		}

		try {
			setError('')
			await authActions.unlockVaultedSession(passphrase)
			setPassphrase('')
			setConfirmation('')
		} catch {
			setError('Failed to unlock the session. Please check your passphrase.')
		}
	}

	const handleDiscard = () => {
		authActions.discardVaultedSession()
		setPassphrase('')
		setConfirmation('')
		setError('')
	}

	const canSubmit = Boolean(passphrase) && (!isLegacyMigration || (Boolean(confirmation) && !confirmationMismatch))

	return (
		<Dialog open>
			<DialogContent className="sm:max-w-[425px]" data-testid="session-unlock-dialog" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{isLegacyMigration ? 'Secure Your Session' : 'Unlock Your Session'}</DialogTitle>
					{isLegacyMigration ? (
						<DialogDescription>
							Choose a passphrase to encrypt your saved Nostr session. The unsecured copy is removed from this device after
							the session is re-encrypted — if you forget this passphrase, the saved session cannot be recovered.
						</DialogDescription>
					) : (
						<DialogDescription>
							Enter the passphrase protecting your saved Nostr session. The session is re-encrypted on this device and the
							unsecured copy is removed.
						</DialogDescription>
					)}
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="session-passphrase">
							{isLegacyMigration ? 'New session passphrase' : 'Session passphrase'}
						</Label>
						<Input
							id="session-passphrase"
							type="password"
							placeholder={isLegacyMigration ? 'Choose a passphrase' : 'Enter your session passphrase'}
							value={passphrase}
							onChange={(e) => setPassphrase(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && canSubmit) {
									handleUnlock()
								}
							}}
							data-testid="session-passphrase-input"
						/>
					</div>

					{isLegacyMigration && (
						<div className="space-y-2">
							<Label htmlFor="session-passphrase-confirm">Confirm passphrase</Label>
							<Input
								id="session-passphrase-confirm"
								type="password"
								placeholder="Repeat the passphrase"
								value={confirmation}
								onChange={(e) => setConfirmation(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && canSubmit) {
										handleUnlock()
									}
								}}
								data-testid="session-passphrase-confirm-input"
							/>
							{confirmation && confirmationMismatch && <p className="text-sm text-red-500">Passphrases do not match</p>}
						</div>
					)}

					{error && <p className="text-sm text-red-500">{error}</p>}

					<Button
						onClick={handleUnlock}
						disabled={isAuthenticating || !canSubmit}
						className="w-full"
						data-testid="session-unlock-button"
					>
						{isAuthenticating ? <Loader2 className="h-4 w-4 animate-spin" /> : isLegacyMigration ? 'Secure & Continue' : 'Unlock'}
					</Button>

					<div className="relative flex items-center py-2">
						<div className="flex-grow border-t border-muted"></div>
						<span className="flex-shrink-0 mx-4 text-xs text-muted-foreground">OR</span>
						<div className="flex-grow border-t border-muted"></div>
					</div>

					<Button
						onClick={handleDiscard}
						variant="outline"
						disabled={isAuthenticating}
						className="w-full text-destructive hover:text-destructive"
						data-testid="session-discard-button"
					>
						<LogOut className="h-4 w-4 mr-2" />
						Discard Session & Logout
					</Button>

					<p className="text-xs text-muted-foreground text-center mt-2">
						Discarding deletes the saved session from this device. You will need your bunker URL or another login method to
						sign in again.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	)
}
