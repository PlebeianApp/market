import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authActions, NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY } from '@/lib/stores/auth'
import { generateSecretKey, nip19 } from 'nostr-tools'
import { useState, useEffect, useRef } from 'react'
import { Loader2, Eye, EyeOff } from 'lucide-react'

interface PrivateKeyLoginProps {
	onError?: (error: string) => void
	onSuccess?: () => void
}

export function PrivateKeyLogin({ onError, onSuccess }: PrivateKeyLoginProps) {
	const [privateKey, setPrivateKey] = useState('')
	const [encryptionPassword, setEncryptionPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [hasStoredKey, setHasStoredKey] = useState(false)
	const [storedPubkey, setStoredPubkey] = useState<string | null>(null)
	const [showPasswordInput, setShowPasswordInput] = useState(false)
	const [showPrivateKey, setShowPrivateKey] = useState(false)
	const privateKeyInputRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const storedKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		if (storedKey) {
			setHasStoredKey(true)
			try {
				const [pubkey] = storedKey.split(':')
				setStoredPubkey(pubkey)
			} catch (e) {
				console.error('Failed to parse stored key:', e)
			}
		}
	}, [])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (privateKeyInputRef.current && !privateKeyInputRef.current.contains(event.target as Node)) {
				setShowPrivateKey(false)
			}
		}

		if (showPrivateKey) {
			document.addEventListener('mousedown', handleClickOutside)
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
		}
	}, [showPrivateKey])

	const encryptAndStoreKey = async (key: string, password: string) => {
		try {
			const pubkey = nip19.decode(key).data as string
			const encryptedKey = `${pubkey}:${key}`
			localStorage.setItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, encryptedKey)
			setHasStoredKey(true)
			setStoredPubkey(pubkey)
		} catch (error) {
			throw new Error('Failed to encrypt and store key')
		}
	}

	const handleValidatePrivateKey = async () => {
		try {
			setIsLoading(true)
			await authActions.loginWithPrivateKey(privateKey)
			setPrivateKey('')
			onSuccess?.()
		} catch (error) {
			console.error('Private key validation failed:', error)
			onError?.(error instanceof Error ? error.message : 'Private key validation failed')
		} finally {
			setIsLoading(false)
		}
	}

	const handleContinue = () => {
		if (!privateKey) return
		setShowPasswordInput(true)
	}

	const handleEncryptAndStore = async () => {
		if (encryptionPassword !== confirmPassword) {
			setPasswordError('Passwords do not match')
			return
		}

		if (encryptionPassword === '') {
			setPasswordError('Password cannot be empty')
			return
		}

		try {
			setIsLoading(true)
			await encryptAndStoreKey(privateKey, encryptionPassword)
			await handleValidatePrivateKey()
		} catch (error) {
			setPasswordError(error instanceof Error ? error.message : 'Failed to encrypt and store key')
		} finally {
			setIsLoading(false)
		}
	}

	const handleStoredKeyLogin = async () => {
		if (!encryptionPassword) {
			setPasswordError('Please enter your password')
			return
		}

		try {
			setIsLoading(true)
			const storedKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			if (!storedKey) {
				throw new Error('No stored key found')
			}

			const [, key] = storedKey.split(':')
			await authActions.loginWithPrivateKey(key)
			onSuccess?.()
		} catch (error) {
			setPasswordError(error instanceof Error ? error.message : 'Failed to decrypt key')
		} finally {
			setIsLoading(false)
		}
	}

	const clearStoredKey = () => {
		localStorage.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		setHasStoredKey(false)
		setStoredPubkey(null)
		setEncryptionPassword('')
		setConfirmPassword('')
		setPasswordError('')
	}

	if (hasStoredKey) {
		return (
			<div className="space-y-4 py-4">
				<div className="space-y-2">
					<Label htmlFor="stored-password">Enter Password</Label>
					<p className="text-sm text-muted-foreground">Enter your password to decrypt your stored private key.</p>
					<p className="text-sm font-medium">Pubkey: {storedPubkey ? `${storedPubkey.slice(0, 8)}...` : 'Unknown'}</p>
					<Input
						id="stored-password"
						type="password"
						placeholder="Password"
						value={encryptionPassword}
						onChange={(e) => setEncryptionPassword(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && encryptionPassword) {
								handleStoredKeyLogin()
							}
						}}
						data-testid="stored-password-input"
					/>
					{passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
				</div>
				<Button onClick={handleStoredKeyLogin} disabled={isLoading} className="w-full" data-testid="stored-key-login-button">
					{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Login'}
				</Button>

				<div className="flex items-center my-4">
					<div className="flex-grow h-px bg-muted"></div>
					<span className="px-2 text-xs text-muted-foreground">OR</span>
					<div className="flex-grow h-px bg-muted"></div>
				</div>

				<Button onClick={clearStoredKey} variant="outline" className="w-full" data-testid="clear-stored-key-button">
					Remove Stored Key & Continue Anonymously
				</Button>
			</div>
		)
	}

	if (showPasswordInput) {
		return (
			<div className="space-y-4 py-4">
				<div className="space-y-2">
					<Label htmlFor="password">Set Password</Label>
					<p className="text-sm text-muted-foreground">Set a password to encrypt your private key.</p>
					<Input
						id="password"
						type="password"
						placeholder="Password"
						value={encryptionPassword}
						onChange={(e) => setEncryptionPassword(e.target.value)}
						data-testid="new-password-input"
					/>
					<Input
						id="confirm-password"
						type="password"
						placeholder="Confirm Password"
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
						data-testid="confirm-password-input"
					/>
					{passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
				</div>
				<Button onClick={handleEncryptAndStore} disabled={isLoading} className="w-full" data-testid="encrypt-continue-button">
					{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Encrypt & Continue'}
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-4 py-4">
			<div className="space-y-2">
				<div className="flex justify-between items-center">
					<Label htmlFor="private-key">Private Key (nsec)</Label>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							const newPrivateKey = generateSecretKey()
							setPrivateKey(nip19.nsecEncode(newPrivateKey))
						}}
						data-testid="generate-key-button"
					>
						Generate New Key
					</Button>
				</div>
				<div className="relative" ref={privateKeyInputRef}>
					<Input
						id="private-key"
						type={showPrivateKey ? 'text' : 'password'}
						placeholder="nsec1..."
						value={privateKey}
						onChange={(e) => setPrivateKey(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && privateKey) {
								handleContinue()
							}
						}}
						className="pr-10"
						data-testid="private-key-input"
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
						onClick={() => setShowPrivateKey(!showPrivateKey)}
						data-testid="toggle-private-key-visibility"
					>
						{showPrivateKey ? <EyeOff className="h-4 w-4 text-gray-500" /> : <Eye className="h-4 w-4 text-gray-500" />}
					</Button>
				</div>
			</div>
			<Button onClick={handleContinue} disabled={isLoading || !privateKey} className="w-full" data-testid="continue-button">
				{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue'}
			</Button>
		</div>
	)
}
