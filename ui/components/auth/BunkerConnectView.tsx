import { useCallback, useState } from 'react'
import { ExternalLink, Loader2, QrCode } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'

export interface BunkerConnectViewProps {
	bunkerUrl: string
	onBunkerUrlChange: (url: string) => void
	error: string | null
	/** Already vetted by the host as a safe approval URL. */
	authUrl: string | null
	isConnecting: boolean
	onConnect: () => void
	/** Called with a scanned `bunker://` URI. */
	onScanned: (url: string) => void
}

export function BunkerConnectView({
	bunkerUrl,
	onBunkerUrlChange,
	error,
	authUrl,
	isConnecting,
	onConnect,
	onScanned,
}: BunkerConnectViewProps) {
	const [showScanner, setShowScanner] = useState(false)
	const [scanError, setScanError] = useState<string | null>(null)

	const handleScan = useCallback(
		(detectedCodes: { rawValue: string }[]) => {
			const result = detectedCodes?.[0]?.rawValue
			if (!result) return
			if (result.startsWith('bunker://')) {
				onScanned(result)
				setShowScanner(false)
			} else {
				setScanError('The scanned code is not a valid bunker:// URI')
			}
		},
		[onScanned],
	)

	const handleScanError = useCallback((err: unknown) => {
		console.error(err)
		setScanError('Error accessing camera: ' + ((err as Error)?.message || 'Unknown error'))
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
						onChange={(e) => onBunkerUrlChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && bunkerUrl) onConnect()
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
							setShowScanner(true)
							setScanError(null)
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

			<Button onClick={onConnect} disabled={isConnecting || !bunkerUrl.trim()} className="w-full" data-testid="connect-bunker-button">
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
								<Scanner onScan={handleScan} onError={handleScanError} constraints={{ facingMode: 'environment' }} />
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
