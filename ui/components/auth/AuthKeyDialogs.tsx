import { useState } from 'react'
import { Loader2, LogOut } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'

export interface DecryptPasswordDialogViewProps {
	open: boolean
	/** Resolves on success; rejection shows the decrypt error. */
	onDecrypt: (password: string) => Promise<void>
	onLogout: () => void
}

export function DecryptPasswordDialogView({ open, onDecrypt, onLogout }: DecryptPasswordDialogViewProps) {
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
			await onDecrypt(password)
		} catch {
			setError('Failed to decrypt key. Please check your password.')
		} finally {
			setIsLoading(false)
		}
	}

	const handleLogout = () => {
		try {
			setIsLoggingOut(true)
			setError('')
			onLogout()
		} catch {
			setError('Failed to clear stored key.')
		} finally {
			setIsLoggingOut(false)
		}
	}

	return (
		<Dialog open={open}>
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
								if (e.key === 'Enter') handleSubmit()
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

export interface MigratePrivateKeyDialogViewProps {
	open: boolean
	/** Host policy; production requires 8. */
	minPasswordLength: number
	onEncrypt: (password: string) => Promise<void>
}

export function MigratePrivateKeyDialogView({ open, minPasswordLength, onEncrypt }: MigratePrivateKeyDialogViewProps) {
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [error, setError] = useState('')
	const [isLoading, setIsLoading] = useState(false)

	const handleSubmit = async () => {
		if (password !== confirmPassword) {
			setError('Passwords do not match')
			return
		}

		if (password.length < minPasswordLength) {
			setError(`Password must be at least ${minPasswordLength} characters long`)
			return
		}

		try {
			setIsLoading(true)
			setError('')
			await onEncrypt(password)
		} catch {
			setError('Failed to encrypt key')
		} finally {
			setIsLoading(false)
		}
	}

	if (!open) return null

	return (
		<Dialog open={open}>
			<DialogContent className="sm:max-w-[425px]" data-testid="migrate-private-key-dialog">
				<DialogHeader>
					<DialogTitle>Secure Your Account</DialogTitle>
					<DialogDescription>
						For your security, we need to encrypt your private key. Please set a password to protect your account.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="Enter a secure password"
							data-testid="migrate-password-input"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="confirm-password">Confirm Password</Label>
						<Input
							id="confirm-password"
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							placeholder="Confirm your password"
							onKeyDown={(e) => {
								if (e.key === 'Enter' && password && confirmPassword) handleSubmit()
							}}
							data-testid="migrate-confirm-password-input"
						/>
					</div>

					{error && <p className="text-sm text-red-500">{error}</p>}

					<Button
						onClick={handleSubmit}
						disabled={isLoading || !password || !confirmPassword}
						className="w-full"
						data-testid="migrate-encrypt-button"
					>
						{isLoading ? 'Encrypting...' : 'Encrypt & Secure Account'}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
