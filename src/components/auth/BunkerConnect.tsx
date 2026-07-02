import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { authActions } from '@/lib/stores/auth'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { ExternalLink, Loader2, QrCode } from 'lucide-react'
import { useState, useCallback } from 'react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { toast } from 'sonner'

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

export function BunkerConnect({ onError, onSuccess }: BunkerConnectProps) {
	const [bunkerUrl, setBunkerUrl] = useState('')
	const [isConnecting, setIsConnecting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [authUrl, setAuthUrl] = useState<string | null>(null)
	const [showScanner, setShowScanner] = useState(false)
	const [scanError, setScanError] = useState<string | null>(null)

	const validateBunkerUrl = (url: string): boolean => {
		try {
			// Basic validation for bunker:// URL format
			if (!url.startsWith('bunker://')) {
				setError('Invalid bunker URL format. Must start with bunker://')
				return false
			}

			const urlObj = new URL(url)
			const relay = urlObj.searchParams.get('relay')

			if (!relay) {
				setError('Bunker URL must contain a relay parameter')
				return false
			}

			// Extract pubkey from bunker://pubkey?...
			const pubkey = urlObj.hostname
			if (!NOSTR_PUBKEY_HEX_RE.test(pubkey)) {
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
			setAuthUrl(null)
			return
		}

		if (!validateBunkerUrl(bunkerUrl)) {
			setAuthUrl(null)
			return
		}

		try {
			setIsConnecting(true)
			setError(null)
			setAuthUrl(null)

			// Generate a local signer for the connection
			const localSigner = NDKPrivateKeySigner.generate()
			await localSigner.blockUntilReady()

			// Connect using the bunker URL
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

	const handleScanQR = () => {
		setShowScanner(true)
		setScanError(null)
	}

	const handleScan = useCallback((detectedCodes: any[]) => {
		if (detectedCodes && detectedCodes.length > 0) {
			const result = detectedCodes[0].rawValue
			// Check if it's a bunker URI
			if (result && result.startsWith('bunker://')) {
				setBunkerUrl(result)
				setError(null)
				setAuthUrl(null)
				setShowScanner(false)
				toast.success('Bunker URL scanned successfully')
			} else if (result) {
				setScanError('The scanned code is not a valid bunker:// URI')
			}
		}
	}, [])

	const handleScanError = useCallback((err: any) => {
		console.error(err)
		setScanError('Error accessing camera: ' + (err.message || 'Unknown error'))
	}, [])

	return (
		<div className="space-y-4 py-4 w-full max-w-full overflow-hidden">
			<div className="space-y-2 max-w-full">
				<Label htmlFor="bunker-url">Bunker URL</Label>
				<p className="text-sm text-muted-foreground">
					Paste your bunker:// connection string from your remote signer (e.g., nsec.app, Amber).
				</p>
				<div className="flex gap-2 max-w-full min-w-0">
					<Input
						id="bunker-url"
						type="text"
						placeholder="bunker://..."
						value={bunkerUrl}
						onChange={(e) => {
							setBunkerUrl(e.target.value)
							setError(null)
							setAuthUrl(null)
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && bunkerUrl) {
								handleConnect()
							}
						}}
						className="font-mono text-sm min-w-0"
						data-testid="bunker-url-input"
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="shrink-0"
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							handleScanQR()
						}}
						title="Scan QR code"
						data-testid="scan-qr-button"
					>
						<QrCode className="h-4 w-4" />
					</Button>
				</div>
				{error && <p className="text-sm text-red-500">{error}</p>}
				{authUrl && (
					<div className="rounded-md border bg-muted/50 p-3 text-sm space-y-2" data-testid="bunker-auth-challenge">
						<p className="text-muted-foreground">Your signer needs browser approval before this connection can finish.</p>
						<p className="text-xs text-muted-foreground break-all">{authUrl}</p>
						<Button asChild variant="outline" size="sm">
							<a href={authUrl} target="_blank" rel="noreferrer" data-testid="bunker-auth-url-link">
								<ExternalLink className="h-4 w-4" />
								Open approval page
							</a>
						</Button>
					</div>
				)}
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
					<li>Paste it into the field above or scan the QR code</li>
				</ol>
			</div>

			{/* QR Scanner Dialog */}
			<Dialog open={showScanner} onOpenChange={setShowScanner}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Scan Bunker QR Code</DialogTitle>
						<DialogDescription>Scan a bunker:// connection QR code from your remote signer</DialogDescription>
					</DialogHeader>

					<div className="mt-4 mb-4">
						{scanError ? (
							<div className="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
								{scanError}
								<Button onClick={() => setScanError(null)} variant="outline" size="sm" className="ml-2">
									Try Again
								</Button>
							</div>
						) : (
							<div className="relative w-full aspect-square overflow-hidden rounded-lg">
								<Scanner
									onScan={handleScan}
									onError={handleScanError}
									constraints={{
										facingMode: 'environment',
									}}
								/>
							</div>
						)}
					</div>

					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={() => setShowScanner(false)}>
							Cancel
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}
