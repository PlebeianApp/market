import { authActions, NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY } from '@/lib/stores/auth'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { decrypt, encrypt } from 'nostr-tools/nip49'
import { useEffect, useState } from 'react'
import { PrivateKeyLoginView, type PrivateKeyLoginStep } from '@ui/components/auth/PrivateKeyLoginView'

interface PrivateKeyLoginProps {
	onError?: (error: string) => void
	onSuccess?: () => void
}

/**
 * Validates and normalizes a private key: accepts an nsec1... string or a
 * 64-character hex key (converted to nsec). Throws with a user-facing message.
 */
function normalizePrivateKey(key: string): string {
	const trimmedKey = key.trim()

	if (!trimmedKey) {
		throw new Error('Private key cannot be empty')
	}

	if (trimmedKey.startsWith('nsec1')) {
		try {
			const decoded = nip19.decode(trimmedKey)
			if (decoded.type !== 'nsec') {
				throw new Error('Invalid nsec format')
			}
			return trimmedKey
		} catch {
			throw new Error('Invalid nsec format: Failed to decode')
		}
	}

	if (/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
		try {
			const hexBytes = new Uint8Array(32)
			for (let i = 0; i < 32; i++) {
				hexBytes[i] = parseInt(trimmedKey.slice(i * 2, i * 2 + 2), 16)
			}
			return nip19.nsecEncode(hexBytes)
		} catch {
			throw new Error('Failed to convert hex to nsec')
		}
	}

	if (trimmedKey.length === 64) {
		throw new Error('Invalid hex key: Must contain only characters 0-9 and a-f')
	}

	throw new Error('Invalid format: Please enter a valid nsec1... key or a 64-character hex key')
}

export function PrivateKeyLogin({ onError, onSuccess }: PrivateKeyLoginProps) {
	const [privateKey, setPrivateKey] = useState('')
	const [encryptionPassword, setEncryptionPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [keyError, setKeyError] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [hasStoredKey, setHasStoredKey] = useState(false)
	const [storedPubkey, setStoredPubkey] = useState<string | null>(null)
	const [showPasswordInput, setShowPasswordInput] = useState(false)
	const [isGeneratedKey, setIsGeneratedKey] = useState(false)

	useEffect(() => {
		const storedKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		if (storedKey) {
			setHasStoredKey(true)
			setStoredPubkey(storedKey.split(':')[0])
		}
	}, [])

	// Stored as "pubkey:ncryptsec..." (NIP-49).
	const encryptAndStoreKey = async (key: string, password: string) => {
		try {
			const { data: secretKeyBytes } = nip19.decode(normalizePrivateKey(key)) as { data: Uint8Array }
			const pubkey = getPublicKey(secretKeyBytes)
			localStorage.setItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, `${pubkey}:${encrypt(secretKeyBytes, password)}`)
			setHasStoredKey(true)
			setStoredPubkey(pubkey)
		} catch (error) {
			throw new Error(`Failed to encrypt and store key: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
	}

	const handleValidatePrivateKey = async () => {
		try {
			setIsLoading(true)
			setKeyError(null)
			await authActions.loginWithPrivateKey(normalizePrivateKey(privateKey))
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

		try {
			normalizePrivateKey(privateKey)
			setKeyError(null)
			setShowPasswordInput(true)
		} catch (error) {
			setKeyError(error instanceof Error ? error.message : 'Invalid key format')
		}
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

		if (process.env.NODE_ENV === 'production' && encryptionPassword.length < 8) {
			setPasswordError('Password must be at least 8 characters long')
			return
		}

		try {
			setIsLoading(true)
			setPasswordError('')
			await encryptAndStoreKey(privateKey, encryptionPassword)
			await handleValidatePrivateKey()
		} catch {
			setPasswordError('Failed to encrypt and store key')
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
			setPasswordError('')

			const storedKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			if (!storedKey) {
				throw new Error('No stored key found')
			}

			const [, encryptedKey] = storedKey.split(':')
			const privateKeyHex = Array.from(decrypt(encryptedKey, encryptionPassword))
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('')

			await authActions.loginWithPrivateKey(privateKeyHex)
			onSuccess?.()
		} catch {
			setPasswordError('Failed to decrypt key. Please check your password.')
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
		setKeyError(null)
	}

	const step: PrivateKeyLoginStep = hasStoredKey ? 'stored-key' : showPasswordInput ? 'set-password' : 'enter-key'

	return (
		<PrivateKeyLoginView
			step={step}
			isLoading={isLoading}
			storedPubkey={storedPubkey}
			privateKey={privateKey}
			onPrivateKeyChange={(value) => {
				setPrivateKey(value)
				if (keyError) setKeyError(null)
			}}
			keyError={keyError}
			password={encryptionPassword}
			onPasswordChange={setEncryptionPassword}
			confirmPassword={confirmPassword}
			onConfirmPasswordChange={setConfirmPassword}
			passwordError={passwordError}
			isGeneratedKey={isGeneratedKey}
			onGenerateKey={() => {
				setPrivateKey(nip19.nsecEncode(generateSecretKey()))
				setIsGeneratedKey(true)
				setKeyError(null)
			}}
			onContinue={handleContinue}
			onEncryptAndStore={() => void handleEncryptAndStore()}
			onStoredKeyLogin={() => void handleStoredKeyLogin()}
			onClearStoredKey={clearStoredKey}
		/>
	)
}
