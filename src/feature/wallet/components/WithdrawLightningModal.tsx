import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import { Loader2, Check, Zap, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { Scanner } from '@yudiel/react-qr-scanner'

interface WithdrawLightningModalProps {
	open: boolean
	onClose: () => void
}

export function WithdrawLightningModal({ open, onClose }: WithdrawLightningModalProps) {
	const { balance } = useStore(nip60Store)
	const [invoice, setInvoice] = useState('')
	const [isWithdrawing, setIsWithdrawing] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleWithdraw = async () => {
		if (!invoice.trim()) {
			toast.error('Please enter a Lightning invoice')
			return
		}

		// Basic validation for Lightning invoice
		const normalizedInvoice = invoice.toLowerCase().trim()
		if (!normalizedInvoice.startsWith('lnbc') && !normalizedInvoice.startsWith('lightning:')) {
			toast.error('Invalid Lightning invoice format')
			return
		}

		setIsWithdrawing(true)
		setError(null)
		try {
			// Remove lightning: prefix if present
			const cleanInvoice = invoice.replace(/^lightning:/i, '').trim()
			await nip60Actions.withdrawLightning(cleanInvoice)
			setIsSuccess(true)
			toast.success('Withdrawal successful!')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Withdrawal failed'
			setError(message)
			toast.error(message)
		} finally {
			setIsWithdrawing(false)
		}
	}

	const handleScan = (detectedCodes: any[]) => {
		if (detectedCodes && detectedCodes.length > 0) {
			const result = detectedCodes[0].rawValue
			if (result) {
				// Remove lightning: prefix if present
				const cleanInvoice = result.replace(/^lightning:/i, '').trim()
				setInvoice(cleanInvoice)
				setShowScanner(false)
				toast.success('Invoice scanned')
			}
		}
	}

	const handleClose = () => {
		setInvoice('')
		setIsSuccess(false)
		setShowScanner(false)
		setError(null)
		onClose()
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="w-5 h-5 text-orange-500" />
						Withdraw to Lightning
					</DialogTitle>
					<DialogDescription>Pay a Lightning invoice using your eCash (Balance: {balance.toLocaleString()} sats)</DialogDescription>
				</DialogHeader>

				{isSuccess ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
							<Check className="w-6 h-6 text-green-600" />
						</div>
						<p className="text-lg font-medium text-green-600">Withdrawal Successful!</p>
						<p className="text-sm text-muted-foreground mt-2">Your Lightning invoice has been paid</p>
						<Button onClick={handleClose} className="mt-4">
							Done
						</Button>
					</div>
				) : showScanner ? (
					<div className="space-y-4">
						<div className="relative w-full aspect-square overflow-hidden rounded-lg">
							<Scanner
								onScan={handleScan}
								onError={(err) => {
									console.error('Scanner error:', err)
									toast.error('Camera error')
								}}
								constraints={{ facingMode: 'environment' }}
							/>
						</div>
						<div className="flex justify-end">
							<Button variant="outline" onClick={() => setShowScanner(false)}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Lightning Invoice</label>
							<div className="flex gap-2">
								<textarea
									value={invoice}
									onChange={(e) => setInvoice(e.target.value)}
									placeholder="lnbc..."
									className="flex-1 px-3 py-2 text-sm border rounded-md bg-background font-mono resize-none h-24"
								/>
							</div>
							<div className="flex justify-end">
								<Button variant="ghost" size="sm" onClick={() => setShowScanner(true)} className="gap-2">
									<ScanLine className="w-4 h-4" />
									Scan QR
								</Button>
							</div>
						</div>

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleWithdraw} disabled={isWithdrawing || !invoice.trim()}>
								{isWithdrawing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Withdraw
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
