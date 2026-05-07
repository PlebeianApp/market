import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, authActions } from '@/lib/stores/auth'
import { useState } from 'react'

export function MigratePrivateKeyDialog() {
	const { needsMigration } = useAuth()
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [error, setError] = useState('')
	const [isLoading, setIsLoading] = useState(false)

	const handleSubmit = async () => {
		if (password !== confirmPassword) {
			setError('Passwords do not match')
			return
		}

		if (password.length < 8) {
			setError('Password must be at least 8 characters long')
			return
		}

		try {
			setIsLoading(true)
			setError('')
			await authActions.migrateToEncryptedKey(password)
		} catch (err) {
			setError('Failed to encrypt key')
		} finally {
			setIsLoading(false)
		}
	}

	if (!needsMigration) return null

	return (
		<Dialog open={needsMigration}>
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
								if (e.key === 'Enter' && password && confirmPassword) {
									handleSubmit()
								}
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
