import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authActions } from '@/lib/stores/auth'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

interface BunkerConnectProps {
	onError?: (error: string) => void
	onSuccess?: () => void
}

export function BunkerConnect({ onError, onSuccess }: BunkerConnectProps) {
	const [bunkerUrl, setBunkerUrl] = useState('')
	const [isConnecting, setIsConnecting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const validateBunkerUrl = (url: string): boolean => {
		try {
			// Basic validation for bunker:// URL format
			if (!url.startsWith('bunker://')) {
				setError('Invalid bunker URL format. Must start with bunker://')
				return false
			}

			const urlObj = new URL(url)
			const relay = urlObj.searchParams.get('relay')
			const secret = urlObj.searchParams.get('secret')

			if (!relay) {
				setError('Bunker URL must contain a relay parameter')
				return false
			}

			if (!secret) {
				setError('Bunker URL must contain a secret parameter')
				return false
			}

			// Extract pubkey from bunker://pubkey?...
			const pubkey = urlObj.hostname
			if (!pubkey || pubkey.length !== 64) {
				setError('Invalid pubkey in bunker URL')
				return false
			}

			setError(null)
			return true
		} catch (err) {
			setError('Invalid bunker URL format')
			return false
		}
	}

	const handleConnect = async () => {
		if (!bunkerUrl.trim()) {
			setError('Please enter a bunker URL')
			return
		}

		if (!validateBunkerUrl(bunkerUrl)) {
			return
		}

		try {
			setIsConnecting(true)
			setError(null)

			// Generate a local signer for the connection
			const localSigner = NDKPrivateKeySigner.generate()
			await localSigner.blockUntilReady()

			// Connect using the bunker URL
			await authActions.loginWithNip46(bunkerUrl, localSigner)

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

	return (
		<div className="space-y-4 py-4">
			<div className="space-y-2">
				<Label htmlFor="bunker-url">Bunker URL</Label>
				<p className="text-sm text-muted-foreground">
					Paste your bunker:// connection string from your remote signer (e.g., nsec.app, Amber).
				</p>
				<Input
					id="bunker-url"
					type="text"
					placeholder="bunker://..."
					value={bunkerUrl}
					onChange={(e) => {
						setBunkerUrl(e.target.value)
						setError(null)
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && bunkerUrl) {
							handleConnect()
						}
					}}
					className="font-mono text-sm"
					data-testid="bunker-url-input"
				/>
				{error && <p className="text-sm text-red-500">{error}</p>}
			</div>

			<Button onClick={handleConnect} disabled={isConnecting || !bunkerUrl.trim()} className="w-full" data-testid="connect-bunker-button">
				{isConnecting ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin mr-2" />
						Connecting...
					</>
				) : (
					'Connect'
				)}
			</Button>

			<div className="mt-4 p-3 bg-muted rounded-lg">
				<h4 className="text-sm font-medium mb-2">How to get a bunker URL:</h4>
				<ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
					<li>Open your remote signer app (nsec.app, Amber, etc.)</li>
					<li>Generate or copy your bunker connection string</li>
					<li>Paste it into the field above</li>
				</ol>
			</div>
		</div>
	)
}
