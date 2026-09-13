import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, authActions } from '@/lib/stores/auth'
import { Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'

/**
 * NIP-46 session-unlock prompt (ADR-0008 B-3, review 5654374915 item 1).
 *
 * `getAuthFromLocalStorageAndLogin` surfaces `needsSessionUnlock` on boot when
 * a persisted bunker session exists (encrypted vault, or the legacy plaintext
 * pair awaiting migration) and never silently re-logs in. This dialog is the
 * ONLY consumer that resolves that state — without it a bunker user who saved
 * the vault and enabled auto-login is simply logged out at next boot with no
 * prompt.
 *
 * Both outcomes are explicit: unlocking (migrate-on-unlock for the legacy
 * pair, unwrap for the vault) or discarding the session outright.
 */
export function UnlockSessionDialog() {
	const { needsSessionUnlock } = useAuth()
	const [passphrase, setPassphrase] = useState('')
	const [error, setError] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [isDiscarding, setIsDiscarding] = useState(false)

	const handleUnlock = async () => {
		if (!passphrase) {
			setError('Please enter your session passphrase')
			return
		}

		try {
			setIsLoading(true)
			setError('')
			await authActions.unlockVaultedSession(passphrase)
			setPassphrase('')
		} catch (err) {
			// Fail closed: nothing migrated, nothing unwrapped — the prompt
			// stays up so the user can retry or discard.
			console.error('Failed to unlock session vault:', err)
			setError('Failed to unlock your session. Check your passphrase and try again.')
		} finally {
			setIsLoading(false)
		}
	}

	const handleDiscard = () => {
		try {
			setIsDiscarding(true)
			setError('')
			// Intentional, user-visible forced re-login (ADR-0008 invariant 4b):
			// deletes the persisted session and logs out — plaintext bearer
			// storage is never retained.
			authActions.discardVaultedSession()
			setPassphrase('')
		} catch (err) {
			console.error('Failed to discard session:', err)
			setError('Failed to discard the saved session.')
		} finally {
			setIsDiscarding(false)
		}
	}

	return (
		<Dialog open={needsSessionUnlock}>
			<DialogContent className="sm:max-w-[425px]" data-testid="session-unlock-dialog" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Unlock Your Session</DialogTitle>
					<DialogDescription>
						You have a saved Nostr Connect (bunker) session on this device. Enter its passphrase to restore it. If this session predates
						encrypted vaults, the passphrase you enter now becomes its new passphrase.
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
								if (e.key === 'Enter') handleUnlock()
							}}
							data-testid="session-unlock-passphrase-input"
						/>
						{error && <p className="text-sm text-red-500">{error}</p>}
					</div>

					<Button onClick={handleUnlock} disabled={isLoading || isDiscarding} className="w-full" data-testid="session-unlock-button">
						{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
						{isLoading ? 'Unlocking...' : 'Unlock & Login'}
					</Button>

					<div className="relative flex items-center py-2">
						<div className="flex-grow border-t border-muted"></div>
						<span className="flex-shrink-0 mx-4 text-xs text-muted-foreground">OR</span>
						<div className="flex-grow border-t border-muted"></div>
					</div>

					<Button
						onClick={handleDiscard}
						variant="outline"
						disabled={isLoading || isDiscarding}
						className="w-full text-destructive hover:text-destructive"
						data-testid="session-unlock-discard-button"
					>
						{isDiscarding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
						Discard Session & Log Out
					</Button>

					<p className="text-xs text-muted-foreground text-center mt-2">
						Discarding deletes the saved session from this device. You will need to connect your signer again to log in.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	)
}
