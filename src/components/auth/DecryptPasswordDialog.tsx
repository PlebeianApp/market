// components/dialogs/DecryptPasswordDialog.tsx
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, authActions } from '@/lib/stores/auth'
import { Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'

export function DecryptPasswordDialog() {
	const { needsDecryptionPassword } = useAuth()
	const [password, setPassword] = useState('')
	const [error, setError] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [isLoggingOut, setIsLoggingOut] = useState(false)

	const handleSubmit = async () => {
		if (!password) {
			setError('Please enter your password')
			return
		}

		try {
			setIsLoading(true)
			setError('')
			await authActions.decryptAndLogin(password)
		} catch (error) {
			setError('Failed to decrypt key. Please check your password.')
		} finally {
			setIsLoading(false)
		}
	}

	const handleLogout = async () => {
		try {
			setIsLoggingOut(true)
			setError('')
			// This clears localStorage keys and resets the auth store state
			await authActions.logout()
			// The dialog will close automatically because needsDecryptionPassword becomes false
		} catch (error) {
			setError('Failed to clear stored key.')
		} finally {
			setIsLoggingOut(false)
		}
	}

	return (
		<Dialog open={needsDecryptionPassword}>
			<DialogContent className="sm:max-w-[425px]" data-testid="decrypt-password-dialog" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Decrypt Private Key</DialogTitle>
					<DialogDescription>Enter your password to decrypt your stored private key.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							placeholder="Enter your password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									handleSubmit()
								}
							}}
							data-testid="decrypt-password-input"
						/>
						{error && <p className="text-sm text-red-500">{error}</p>}
					</div>

					<Button onClick={handleSubmit} disabled={isLoading || isLoggingOut} className="w-full" data-testid="decrypt-login-button">
						{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Decrypt & Login'}
					</Button>

					<div className="relative flex items-center py-2">
						<div className="flex-grow border-t border-muted"></div>
						<span className="flex-shrink-0 mx-4 text-xs text-muted-foreground">OR</span>
						<div className="flex-grow border-t border-muted"></div>
					</div>

					<Button
						onClick={handleLogout}
						variant="outline"
						disabled={isLoading || isLoggingOut}
						className="w-full text-destructive hover:text-destructive"
						data-testid="logout-clear-key-button"
					>
						{isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogOut className="h-4 w-4 mr-2" />}
						Remove Stored Key & Logout
					</Button>

					<p className="text-xs text-muted-foreground text-center mt-2">
						This will delete your encrypted private key from this device. You will need your password or a new key to log in again.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	)
}
