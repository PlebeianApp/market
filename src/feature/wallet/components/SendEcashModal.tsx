import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import { Loader2, Copy, Check, Send } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'

interface SendEcashModalProps {
	open: boolean
	onClose: () => void
}

export function SendEcashModal({ open, onClose }: SendEcashModalProps) {
	const { balance, mints, defaultMint, mintBalances } = useStore(nip60Store)
	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>(defaultMint ?? mints[0] ?? '')
	const [isGenerating, setIsGenerating] = useState(false)
	const [generatedToken, setGeneratedToken] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleGenerate = async () => {
		const amountNum = parseInt(amount, 10)
		if (isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		if (amountNum > balance) {
			toast.error('Insufficient balance')
			return
		}

		setIsGenerating(true)
		setError(null)
		try {
			const token = await nip60Actions.sendEcash(amountNum, selectedMint || undefined)
			if (token) {
				setGeneratedToken(token)
				toast.success('eCash token generated!')
			} else {
				throw new Error('Failed to generate token')
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to generate eCash token'
			setError(message)
			toast.error(message)
		} finally {
			setIsGenerating(false)
		}
	}

	const handleCopyToken = async () => {
		if (!generatedToken) return
		try {
			await navigator.clipboard.writeText(generatedToken)
			setCopied(true)
			toast.success('Token copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy token')
		}
	}

	const handleClose = () => {
		setAmount('')
		setGeneratedToken(null)
		setCopied(false)
		setError(null)
		onClose()
	}

	// Get mints that have balance
	const mintsWithBalance = mints.filter((mint) => (mintBalances[mint] ?? 0) > 0)

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Send className="w-5 h-5 text-purple-500" />
						Send eCash
					</DialogTitle>
					<DialogDescription>Generate a Cashu token to send eCash (Balance: {balance.toLocaleString()} sats)</DialogDescription>
				</DialogHeader>

				{generatedToken ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<div className="p-4 bg-white rounded-lg">
								<QRCodeSVG value={generatedToken} size={200} />
							</div>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Cashu Token</p>
							<div className="flex gap-2">
								<textarea
									value={generatedToken}
									readOnly
									className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono resize-none h-24"
								/>
							</div>
							<div className="flex justify-end">
								<Button variant="outline" size="sm" onClick={handleCopyToken} className="gap-2">
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
									{copied ? 'Copied!' : 'Copy Token'}
								</Button>
							</div>
						</div>
						<p className="text-sm text-muted-foreground text-center">Share this token with the recipient. It can only be redeemed once.</p>
						<div className="flex justify-end gap-2">
							<Button onClick={handleClose}>Done</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Amount (sats)</label>
							<input
								type="number"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								placeholder="Enter amount in sats"
								className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								min="1"
								max={balance}
							/>
						</div>

						{mintsWithBalance.length > 1 && (
							<div className="space-y-2">
								<label className="text-sm font-medium">From Mint (optional)</label>
								<select
									value={selectedMint}
									onChange={(e) => setSelectedMint(e.target.value)}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									<option value="">Any mint</option>
									{mintsWithBalance.map((mint) => (
										<option key={mint} value={mint}>
											{new URL(mint).hostname} ({mintBalances[mint]?.toLocaleString() ?? 0} sats)
										</option>
									))}
								</select>
							</div>
						)}

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleGenerate} disabled={isGenerating || !amount}>
								{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Generate Token
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
