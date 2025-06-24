import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/stores/auth'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

export function DecryptPasswordDialog() {
	const { needsDecryptionPassword, decryptAndLogin } = useAuth()
	const [password, setPassword] = useState('')
	const [error, setError] = useState('')
	const [isLoading, setIsLoading] = useState(false)

	const handleSubmit = async () => {
		if (!password) {
			setError('Please enter your password')
			return
		}

		try {
			setIsLoading(true)
			setError('')
			await decryptAndLogin(password)
		} catch (error) {
			setError(error instanceof Error ? error.message : 'Failed to decrypt key')
		} finally {
			setIsLoading(false)
		}
	}

	return (
		<Dialog open={needsDecryptionPassword}>
			<DialogContent className="sm:max-w-[425px]" data-testid="decrypt-password-dialog">
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
					<Button onClick={handleSubmit} disabled={isLoading} className="w-full" data-testid="decrypt-login-button">
						{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Decrypt & Login'}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
