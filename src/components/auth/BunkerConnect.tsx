import { authActions } from '@/lib/stores/auth'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { useState } from 'react'
import { toast } from 'sonner'
import { BunkerConnectView } from '@ui/components/auth/BunkerConnectView'

interface BunkerConnectProps {
	onError?: (error: string) => void
	onSuccess?: () => void
}

const NOSTR_PUBKEY_HEX_RE = /^[0-9a-fA-F]{64}$/
const LOOPBACK_AUTH_URL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function normalizeAuthUrlHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
}

function getSafeAuthUrl(url: string): string | null {
	try {
		const parsedUrl = new URL(url)
		const hostname = normalizeAuthUrlHostname(parsedUrl.hostname)

		if (parsedUrl.protocol === 'https:') {
			return parsedUrl.href
		}

		if (process.env.NODE_ENV !== 'production' && parsedUrl.protocol === 'http:' && LOOPBACK_AUTH_URL_HOSTS.has(hostname)) {
			return parsedUrl.href
		}
	} catch {
		return null
	}

	return null
}

/** Returns an error message, or null when the bunker URL is well formed. */
function getBunkerUrlError(url: string): string | null {
	try {
		if (!url.startsWith('bunker://')) return 'Invalid bunker URL format. Must start with bunker://'

		const urlObj = new URL(url)
		if (!urlObj.searchParams.get('relay')) return 'Bunker URL must contain a relay parameter'
		if (!NOSTR_PUBKEY_HEX_RE.test(urlObj.hostname)) return 'Invalid pubkey in bunker URL'
		return null
	} catch {
		return 'Invalid bunker URL format'
	}
}

export function BunkerConnect({ onError, onSuccess }: BunkerConnectProps) {
	const [bunkerUrl, setBunkerUrl] = useState('')
	const [isConnecting, setIsConnecting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [authUrl, setAuthUrl] = useState<string | null>(null)

	const handleConnect = async () => {
		if (!bunkerUrl.trim()) {
			setError('Please enter a bunker URL')
			setAuthUrl(null)
			return
		}

		const urlError = getBunkerUrlError(bunkerUrl)
		if (urlError) {
			setError(urlError)
			setAuthUrl(null)
			return
		}

		try {
			setIsConnecting(true)
			setError(null)
			setAuthUrl(null)

			const localSigner = NDKPrivateKeySigner.generate()
			await localSigner.blockUntilReady()

			await authActions.loginWithNip46(bunkerUrl, localSigner, {
				onAuthUrl: (url) => {
					const safeAuthUrl = getSafeAuthUrl(url)

					if (!safeAuthUrl) {
						setAuthUrl(null)
						setError('Signer returned an unsafe approval URL. Open your signer directly to approve the connection.')
						toast.error('Signer returned an unsafe approval URL')
						return
					}

					setError(null)
					setAuthUrl(safeAuthUrl)
					toast.info('Open the signer approval page to finish connecting')
				},
			})

			onSuccess?.()
		} catch (err) {
			console.error('Bunker connection error:', err)
			const errorMessage = err instanceof Error ? err.message : 'Failed to connect with bunker URL'
			setError(errorMessage)
			onError?.(errorMessage)
		} finally {
			setIsConnecting(false)
		}
	}

	const resetUrl = (url: string) => {
		setBunkerUrl(url)
		setError(null)
		setAuthUrl(null)
	}

	return (
		<BunkerConnectView
			bunkerUrl={bunkerUrl}
			onBunkerUrlChange={resetUrl}
			error={error}
			authUrl={authUrl}
			isConnecting={isConnecting}
			onConnect={() => void handleConnect()}
			onScanned={(url) => {
				resetUrl(url)
				toast.success('Bunker URL scanned successfully')
			}}
		/>
	)
}
