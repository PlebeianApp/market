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
			<DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#0d0d11] p-5 text-white shadow-2xl sm:max-w-md">
				<DialogHeader className="pr-8 text-left">
					<DialogTitle className="flex items-center gap-2">
						<span className="flex size-9 items-center justify-center rounded-xl bg-pink-500 text-black">
							<Send className="size-4" />
						</span>
						Send eCash
					</DialogTitle>
					<DialogDescription className="text-white/45">Create a private, single-use Cashu token to share.</DialogDescription>
				</DialogHeader>

				{view === 'token' && generatedToken ? (
					<div className="space-y-4">
						<div className="rounded-xl border border-emerald-300/10 bg-emerald-300/[0.05] px-3 py-2 text-center text-xs text-emerald-200">
							Token ready · {amount} sats
						</div>
						{/* QR Code with Error Boundary — if rendering fails (overflow), show fallback */}
						{!tokenTooLargeForQR ? (
							<div className="flex justify-center">
								<div className="w-full max-w-[304px] rounded-2xl bg-white p-3">
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
										<QRCodeSVG className="h-auto w-full" value={generatedToken} size={280} marginSize={4} level="L" />
									</QRErrorBoundary>
								</div>
							</div>
						) : (
							<div className="flex flex-col items-center gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-6 text-center">
								<AlertTriangle className="w-8 h-8 text-yellow-500" />
								<p className="text-sm font-medium">Token too large for QR code</p>
								<p className="text-xs text-muted-foreground">
									This token exceeds QR code capacity. Use copy/paste to share it, or try sending a smaller amount.
								</p>
							</div>
						)}

						<div className="space-y-2">
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Cashu token</p>
							<div className="flex gap-2">
								<textarea
									value={generatedToken}
									readOnly
									className="h-24 flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 font-mono text-sm text-white"
								/>
							</div>
							<div className="flex justify-end">
								<Button
									variant="outline"
									size="sm"
									onClick={handleCopyToken}
									className="gap-2 border-white/10 bg-white/[0.06] text-white hover:bg-white/10"
								>
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
									{copied ? 'Copied!' : 'Copy Token'}
								</Button>
							</div>
						</div>
						<p className="text-center text-sm text-white/55">Share it with the recipient. It can only be redeemed once.</p>
						<p className="text-center text-xs text-white/35">
							Token saved to pending list. You can reclaim it if the recipient doesn't claim it.
						</p>
						<div className="grid grid-cols-2 gap-2">
							<Button
								className="border-white/10 bg-white/[0.06] text-white hover:bg-white/10"
								variant="outline"
								onClick={() => setView('form')}
							>
								Send Another
							</Button>
							<Button className="rounded-xl bg-pink-500 font-semibold text-black hover:bg-pink-400" onClick={handleClose}>
								Done
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-4 text-center">
							<label className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Amount to send</label>
							<div className="mt-3 flex items-baseline justify-center gap-2">
								<input
									type="number"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									placeholder="0"
									aria-label="Amount in sats"
									className="w-32 border-0 bg-transparent text-right text-4xl font-bold tracking-tight text-white outline-none placeholder:text-white/20"
									min="1"
									max={totalBalance}
								/>
								<span className="text-sm text-white/40">sats</span>
							</div>
							<p className="mt-1 text-xs text-white/35">Available: {totalBalance.toLocaleString()} sats</p>
							<div className="mt-3 grid grid-cols-3 gap-2">
								{[
									{ label: '25%', value: Math.max(1, Math.floor(totalBalance * 0.25)) },
									{ label: '50%', value: Math.max(1, Math.floor(totalBalance * 0.5)) },
									{ label: 'Max', value: totalBalance },
								].map((option) => (
									<Button
										key={option.label}
										type="button"
										className="h-8 rounded-lg bg-white/[0.07] text-xs text-white/70 hover:bg-white/15 hover:text-white"
										onClick={() => setAmount(String(option.value))}
										disabled={totalBalance === 0}
									>
										{option.label}
									</Button>
								))}
							</div>
						</div>

						{mintsWithBalance.length > 0 && (
							<div className="space-y-2">
								<label className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Pay from</label>
								<select
									value={selectedMint}
									onChange={(e) => setSelectedMint(e.target.value)}
									className="w-full rounded-xl border border-white/10 bg-[#19191f] px-3 py-2.5 text-sm text-white"
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
							<p className="flex items-center gap-2 text-sm text-white/45">
								<Loader2 className="w-4 h-4 animate-spin" />
								Initializing wallet...
							</p>
						)}

						{error && <p className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}

						<div className="grid grid-cols-2 gap-2">
							<Button className="border-white/10 bg-white/[0.06] text-white hover:bg-white/10" variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button
								className="rounded-xl bg-pink-500 font-semibold text-black hover:bg-pink-400"
								onClick={handleGenerate}
								disabled={isGenerating || !amount || !selectedMint || cashuStatus === 'initializing'}
							>
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
