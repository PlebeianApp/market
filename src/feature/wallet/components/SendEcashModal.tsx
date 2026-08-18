import { useState, useEffect, Component, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cashuActions, cashuStore } from '@/lib/stores/cashu'
import { nip60Store } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import { Loader2, Copy, Check, Send, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { getMintHostname } from '@/lib/wallet'

interface SendEcashModalProps {
	open: boolean
	onClose: () => void
}
/**
 * Maximum byte capacity for a QR code at version 40, error correction level L, byte mode.
 * Using a conservative threshold slightly below the theoretical 2,953 to account for
 * mode indicators and character count overhead in the QR encoding.
 */
const QR_MAX_BYTES = 2900

type View = 'form' | 'token'

/**
 * Error Boundary to catch "code length overflow" errors thrown by QRCodeSVG during render.
 * Without this, a token that exceeds QR capacity will crash the entire modal.
 */
class QRErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
	state = { hasError: false }

	static getDerivedStateFromError(): { hasError: boolean } {
		return { hasError: true }
	}

	componentDidCatch(error: Error): void {
		console.error('[QRCodeSVG] Render error:', error)
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback
		}
		return this.props.children
	}
}

export function SendEcashModal({ open, onClose }: SendEcashModalProps) {
	const { mints, defaultMint, mintBalances, balance: nip60Balance } = useStore(nip60Store)
	const { status: cashuStatus, balances: cashuBalances } = useStore(cashuStore)

	// Always use nip60 balances for display since that's where the actual proofs are stored
	const balances = mintBalances
	const totalBalance = nip60Balance

	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [generatedToken, setGeneratedToken] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [view, setView] = useState<View>('form')

	// Sync selectedMint with defaultMint when modal opens or defaultMint changes
	useEffect(() => {
		if (open) {
			setSelectedMint(defaultMint ?? mints[0] ?? '')
			// Initialize cashu if not ready
			if (cashuStatus === 'idle') {
				cashuActions.initialize()
			}
		}
	}, [open, defaultMint, mints, cashuStatus])

	const handleGenerate = async () => {
		const amountNum = parseInt(amount, 10)
		if (isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		// Check balance at selected mint
		const mintBalance = selectedMint ? (balances[selectedMint] ?? 0) : totalBalance
		if (amountNum > mintBalance) {
			toast.error(`Insufficient balance at ${selectedMint ? getMintHostname(selectedMint) : 'wallet'}`)
			return
		}

		setIsGenerating(true)
		setError(null)
		try {
			// Check if coco has balance at the selected mint
			const cashuMintBalance = cashuBalances[selectedMint] ?? 0
			const useCoco = cashuStatus === 'ready' && selectedMint && cashuMintBalance >= amountNum

			let token: string | null = null

			if (useCoco) {
				// Use coco if it has sufficient balance
				console.log('[SendEcash] Using coco for send')
				token = await cashuActions.send(selectedMint, amountNum)
			} else {
				// Fall back to nip60 which has the actual proofs from Nostr
				console.log('[SendEcash] Using nip60 for send (coco balance:', cashuMintBalance, ')')
				const { nip60Actions } = await import('@/lib/stores/nip60')
				token = await nip60Actions.sendEcash(amountNum, selectedMint || undefined)
			}

			if (token) {
				// Pre-flight check: warn if the token is likely too large for a QR code
				const tokenBytes = new Blob([token]).size
				if (tokenBytes > QR_MAX_BYTES) {
					console.warn(
						`[SendEcash] Token is ${tokenBytes} bytes, exceeds QR capacity (~${QR_MAX_BYTES} bytes). ` +
							`QR code may not render. Consider splitting into smaller amounts.`,
					)
					toast.warning('Token is large — QR code may not be scannable. You can still copy the token text.')
				}

				setGeneratedToken(token)
				setView('token')
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
		setView('form')
		onClose()
	}

	// Get mints that have balance
	const mintsWithBalance = mints.filter((mint) => (balances[mint] ?? 0) > 0)

	// Check if token exceeds QR capacity for conditional UI
	const tokenTooLargeForQR = generatedToken !== null && new Blob([generatedToken]).size > QR_MAX_BYTES

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Send className="w-5 h-5 text-purple-500" />
						Send eCash
					</DialogTitle>
					<DialogDescription>Generate a Cashu token to send eCash (Balance: {totalBalance.toLocaleString()} sats)</DialogDescription>
				</DialogHeader>

				{view === 'token' && generatedToken ? (
					<div className="space-y-4">
						{/* QR Code with Error Boundary — if rendering fails (overflow), show fallback */}
						{!tokenTooLargeForQR ? (
							<div className="flex justify-center">
								<div className="p-4 bg-white rounded-lg">
									<QRErrorBoundary
										fallback={
											<div className="flex flex-col items-center gap-2 p-8 text-center">
												<AlertTriangle className="w-8 h-8 text-yellow-500" />
												<p className="text-sm text-muted-foreground">
													QR code is too dense to render. Use the copy button below to share the token.
												</p>
											</div>
										}
									>
										<QRCodeSVG value={generatedToken} size={360} marginSize={4} level="L" />
									</QRErrorBoundary>
								</div>
							</div>
						) : (
							<div className="flex flex-col items-center gap-2 p-6 text-center border rounded-lg bg-muted/50">
								<AlertTriangle className="w-8 h-8 text-yellow-500" />
								<p className="text-sm font-medium">Token too large for QR code</p>
								<p className="text-xs text-muted-foreground">
									This token exceeds QR code capacity. Use copy/paste to share it, or try sending a smaller amount.
								</p>
							</div>
						)}

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
						<p className="text-xs text-muted-foreground text-center">
							Token saved to pending list. You can reclaim it if the recipient doesn't claim it.
						</p>
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={() => setView('form')}>
								Send Another
							</Button>
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
								max={totalBalance}
							/>
						</div>

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
											{getMintHostname(mint)} ({(balances[mint] ?? 0).toLocaleString()} sats)
										</option>
									))}
								</select>
							</div>
						)}

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
							<Button onClick={handleGenerate} disabled={isGenerating || !amount || !selectedMint || cashuStatus === 'initializing'}>
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
