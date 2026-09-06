import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, authActions } from '@/lib/stores/auth'
import { Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'

/**
 * Session unlock prompt (ADR-0008 B-3). Shown at boot when a legacy plaintext
 * NIP-46 session pair or an encrypted vault exists. Unlocking either wraps the
 * legacy pair into the vault (then deletes the plaintext) or unwraps the vault
 * and rehydrates the NostrConnectSigner. Refusal discards the persisted
 * session entirely — an intentional, user-visible forced re-login; plaintext
 * is never silently retained.
 */
export function SessionUnlockDialog() {
	const { needsSessionUnlock, isAuthenticating } = useAuth()
	const [passphrase, setPassphrase] = useState('')
	const [error, setError] = useState('')

	if (!needsSessionUnlock) return null

	const handleUnlock = async () => {
		if (!passphrase) {
			setError('Please enter your session passphrase')
			return
		}

		try {
			setError('')
			await authActions.unlockVaultedSession(passphrase)
			setPassphrase('')
		} catch {
			setError('Failed to unlock the session. Please check your passphrase.')
		}
	}

	const handleDiscard = () => {
		authActions.discardVaultedSession()
		setPassphrase('')
		setError('')
	}

	return (
		<Dialog open>
			<DialogContent className="sm:max-w-[425px]" data-testid="session-unlock-dialog" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Unlock Your Session</DialogTitle>
					<DialogDescription>
						Enter the passphrase protecting your saved Nostr session. The session is re-encrypted on this device and the unsecured copy is
						removed.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="session-passphrase">Session passphrase</Label>
						<Input
							id="session-passphrase"
							type="password"
							placeholder="Enter your session passphrase"
							value={passphrase}
							onChange={(e) => setPassphrase(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									handleUnlock()
								}
							}}
							data-testid="session-passphrase-input"
						/>
						{error && <p className="text-sm text-red-500">{error}</p>}
					</div>

					<Button onClick={handleUnlock} disabled={isAuthenticating || !passphrase} className="w-full" data-testid="session-unlock-button">
						{isAuthenticating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Unlock'}
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
						Discarding deletes the saved session from this device. You will need your bunker URL or another login method to sign in again.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	)
}
