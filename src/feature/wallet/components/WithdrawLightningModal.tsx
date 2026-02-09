import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cashuActions, cashuStore } from '@/lib/stores/cashu'
import { nip60Store, nip60Actions } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import { Loader2, Check, Zap, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { Scanner } from '@yudiel/react-qr-scanner'

interface WithdrawLightningModalProps {
	open: boolean
	onClose: () => void
}

export function WithdrawLightningModal({ open, onClose }: WithdrawLightningModalProps) {
	const { balance: nip60Balance, mints, defaultMint, mintBalances } = useStore(nip60Store)
	const { status: cashuStatus, balances: cashuBalances } = useStore(cashuStore)

	// Always use nip60 balances for display since that's where the actual proofs are stored
	const balance = nip60Balance
	const balances = mintBalances

	const [invoice, setInvoice] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isWithdrawing, setIsWithdrawing] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Sync selectedMint with defaultMint when modal opens
	useEffect(() => {
		if (open) {
			setSelectedMint(defaultMint ?? mints[0] ?? '')
			// Initialize cashu if not ready
			if (cashuStatus === 'idle') {
				cashuActions.initialize()
			}
		}
	}, [open, defaultMint, mints, cashuStatus])

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

		if (!selectedMint) {
			toast.error('Please select a mint')
			return
		}

		setIsWithdrawing(true)
		setError(null)
		try {
			// Remove lightning: prefix if present
			const cleanInvoice = invoice.replace(/^lightning:/i, '').trim()

			// Check if coco has balance at the selected mint
			const cashuMintBalance = cashuBalances[selectedMint] ?? 0
			const useCoco = cashuStatus === 'ready' && cashuMintBalance > 0

			if (useCoco) {
				console.log('[Withdraw] Using coco for melt')
				await cashuActions.melt(selectedMint, cleanInvoice)
			} else {
				console.log('[Withdraw] Using nip60 for melt (coco balance:', cashuMintBalance, ')')
				await nip60Actions.withdrawLightning(cleanInvoice)
			}

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
		setSelectedMint('')
		setIsSuccess(false)
		setShowScanner(false)
		setError(null)
		onClose()
	}

	// Get mints that have balance
	const mintsWithBalance = mints.filter((mint) => (balances[mint] ?? 0) > 0)

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
						{mintsWithBalance.length > 0 && (
							<div className="space-y-2">
								<label className="text-sm font-medium">From Mint</label>
								<select
									value={selectedMint}
									onChange={(e) => setSelectedMint(e.target.value)}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									{mintsWithBalance.map((mint) => (
										<option key={mint} value={mint}>
											{new URL(mint).hostname} ({(balances[mint] ?? 0).toLocaleString()} sats)
										</option>
									))}
								</select>
							</div>
						)}

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

						{cashuStatus === 'initializing' && (
							<p className="text-sm text-muted-foreground flex items-center gap-2">
								<Loader2 className="w-4 h-4 animate-spin" />
								Initializing wallet...
							</p>
						)}

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button
								onClick={handleWithdraw}
								disabled={isWithdrawing || !invoice.trim() || !selectedMint || cashuStatus === 'initializing'}
							>
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
