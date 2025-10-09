import { useState, useCallback } from 'react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { uiStore } from '@/lib/stores/ui'
import { toast } from 'sonner'

interface QRScannerDialogProps {
	onScan: (data: string) => void
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function QRScannerDialog({ onScan, open, onOpenChange }: QRScannerDialogProps) {
	const [error, setError] = useState<string | null>(null)

	const handleScan = useCallback(
		(detectedCodes: any[]) => {
			if (detectedCodes && detectedCodes.length > 0) {
				const result = detectedCodes[0].rawValue
				// Check if it's an NWC URI or bunker URI
				if (result && (result.startsWith('nostr+walletconnect://') || result.startsWith('bunker://'))) {
					onScan(result)
					onOpenChange(false) // Close the dialog
					toast.success('QR code scanned successfully')
				} else if (result) {
					setError('The scanned code is not a valid Nostr Wallet Connect or Bunker URI')
				}
			}
		},
		[onScan, onOpenChange],
	)

	const handleError = useCallback((err: any) => {
		console.error(err)
		setError('Error accessing camera: ' + (err.message || 'Unknown error'))
	}, [])

	const handleClose = useCallback(() => {
		onOpenChange(false)
		uiStore.setState((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				'scan-qr': false,
			},
		}))
	}, [onOpenChange])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Scan QR Code</DialogTitle>
					<DialogDescription>Scan a Nostr Wallet Connect or Bunker connection QR code</DialogDescription>
				</DialogHeader>

				<div className="mt-4 mb-4">
					{error ? (
						<div className="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
							{error}
							<Button onClick={() => setError(null)} variant="outline" size="sm" className="ml-2">
								Try Again
							</Button>
						</div>
					) : (
						<div className="relative w-full aspect-square overflow-hidden rounded-lg">
							<Scanner
								onScan={handleScan}
								onError={handleError}
								constraints={{
									facingMode: 'environment',
								}}
							/>
						</div>
					)}
				</div>

				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={handleClose}>
						Cancel
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
