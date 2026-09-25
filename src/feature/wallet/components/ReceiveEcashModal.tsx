import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cashuActions, cashuStore } from '@/lib/stores/cashu'
import { nip60Actions } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import { Loader2, Check, QrCode, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { Scanner } from '@yudiel/react-qr-scanner'
import { authStore } from '@/lib/stores/auth'
import { isCocoV2AuctionMode, readCocoV2AuctionEnvironment } from '@/lib/coco/auctions'
import { receiveCocoAuctionFakeFunds } from '@/lib/coco/runtime'
import { ensureBrowserFreshAuctionsdevPreflight } from '@/lib/coco/migration/freshAuctionsdevBrowser'
import type { FreshAuctionsdevPublicReport } from '@/lib/coco/migration/freshAuctionsdevReport'

interface ReceiveEcashModalProps {
	open: boolean
	onClose: () => void
}

export function ReceiveEcashModal({ open, onClose }: ReceiveEcashModalProps) {
	const cocoMode = isCocoV2AuctionMode()
	const { status: cashuStatus } = useStore(cashuStore)
	const { user } = useStore(authStore)
	const [token, setToken] = useState('')
	const [isReceiving, setIsReceiving] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [preflightReport, setPreflightReport] = useState<Readonly<FreshAuctionsdevPublicReport> | null>(null)

	// Initialize cashu when modal opens
	useEffect(() => {
		if (open && !cocoMode && cashuStatus === 'idle') {
			cashuActions.initialize()
		}
	}, [open, cashuStatus, cocoMode])

	const runFreshPreflight = async (): Promise<Readonly<FreshAuctionsdevPublicReport>> => {
		if (!user?.pubkey) throw new Error('Sign in before running the fresh-wallet preflight')
		const environment = readCocoV2AuctionEnvironment()
		if (environment.environmentId !== 'auctionsdev' && environment.environmentId !== 'test') {
			throw new Error('Fresh Coco Auction funding is restricted to auctionsdev/test')
		}
		const report = await ensureBrowserFreshAuctionsdevPreflight({
			account: user.pubkey,
			environment: environment.environmentId,
		})
		setPreflightReport(report)
		console.info(`COCO_FRESH_AUCTIONSDEV_PREFLIGHT_REPORT=${JSON.stringify(report)}`)
		return report
	}

	const handlePreflight = async () => {
		setIsReceiving(true)
		setError(null)
		try {
			await runFreshPreflight()
			toast.success('Fresh wallet preflight ready')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Fresh wallet preflight failed'
			setError(message)
			toast.error(message)
		} finally {
			setIsReceiving(false)
		}
	}

	const downloadPreflightReport = () => {
		if (!preflightReport) return
		const url = URL.createObjectURL(new Blob([`${JSON.stringify(preflightReport, null, 2)}\n`], { type: 'application/json' }))
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = `fresh-auctionsdev-preflight-${preflightReport.marketCommit}.json`
		anchor.click()
		URL.revokeObjectURL(url)
	}

	const handleReceive = async () => {
		if (!token.trim()) {
			toast.error('Please enter a Cashu token')
			return
		}

		// Basic validation for Cashu token
		const normalizedToken = token.trim()
		if (!normalizedToken.startsWith('cashuA') && !normalizedToken.startsWith('cashuB')) {
			toast.error('Invalid Cashu token format')
			return
		}

		setIsReceiving(true)
		setError(null)
		try {
			if (cocoMode) {
				if (!user?.pubkey) throw new Error('Sign in before receiving Coco Auction fake funds')
				const environment = readCocoV2AuctionEnvironment()
				await runFreshPreflight()
				await receiveCocoAuctionFakeFunds({ accountPubkey: user.pubkey, environmentId: environment.environmentId }, normalizedToken)
				window.dispatchEvent(new Event('coco-auction-balance-changed'))
			} else {
				await nip60Actions.receiveEcash(normalizedToken)
			}
			setIsSuccess(true)
			toast.success('eCash received successfully!')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to receive eCash'
			setError(message)
			toast.error(message)
		} finally {
			setIsReceiving(false)
		}
	}

	const handleScan = (detectedCodes: any[]) => {
		if (detectedCodes && detectedCodes.length > 0) {
			const result = detectedCodes[0].rawValue
			if (result && (result.startsWith('cashuA') || result.startsWith('cashuB'))) {
				setToken(result)
				setShowScanner(false)
				toast.success('Token scanned')
			} else if (result) {
				toast.error('Invalid Cashu token')
			}
		}
	}

	const handleClose = () => {
		setToken('')
		setIsSuccess(false)
		setShowScanner(false)
		setError(null)
		setPreflightReport(null)
		onClose()
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#0d0d11] p-5 text-white shadow-2xl sm:max-w-md">
				<DialogHeader className="pr-8 text-left">
					<DialogTitle className="flex items-center gap-2">
						<span className="flex size-9 items-center justify-center rounded-xl bg-yellow-300 text-black">
							<QrCode className="size-4" />
						</span>
						Receive eCash
					</DialogTitle>
					<DialogDescription className="text-white/45">Scan or paste a Cashu token. It lands in your wallet instantly.</DialogDescription>
				</DialogHeader>

				{isSuccess ? (
					<div className="py-6 text-center">
						<div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-400/15">
							<Check className="size-7 text-emerald-300" />
						</div>
						<p className="text-lg font-semibold text-emerald-300">eCash Received!</p>
						<p className="mt-2 text-sm text-white/45">Your balance is ready to use.</p>
						<Button onClick={handleClose} className="mt-5 w-full rounded-xl bg-pink-500 text-black hover:bg-pink-400">
							Done
						</Button>
					</div>
				) : showScanner ? (
					<div className="space-y-4">
						<div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-white/10">
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
							<Button
								className="border-white/10 bg-white/[0.06] text-white hover:bg-white/10"
								variant="outline"
								onClick={() => setShowScanner(false)}
							>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						{cocoMode && (
							<details className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2.5 text-sm">
								<summary className="cursor-pointer text-xs font-medium text-amber-200">Test wallet details</summary>
								<p className="mt-2 text-xs leading-relaxed text-amber-100/60">
									Fake funds are verified automatically before they enter this wallet.
								</p>
								<div className="mt-3 flex flex-wrap gap-2">
									<Button
										type="button"
										className="border-amber-200/20 bg-transparent text-amber-100 hover:bg-amber-200/10"
										variant="outline"
										onClick={handlePreflight}
										disabled={isReceiving}
									>
										Verify now
									</Button>
									{preflightReport && (
										<Button
											type="button"
											className="border-amber-200/20 bg-transparent text-amber-100 hover:bg-amber-200/10"
											variant="outline"
											onClick={downloadPreflightReport}
										>
											Download report
										</Button>
									)}
								</div>
							</details>
						)}
						<div className="space-y-2">
							<label className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Cashu token</label>
							<textarea
								value={token}
								onChange={(e) => setToken(e.target.value)}
								placeholder="cashuA..."
								className="h-28 w-full resize-none rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3 font-mono text-sm text-white outline-none placeholder:text-white/20 focus:border-pink-400/50"
							/>
							<div className="flex justify-end">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setShowScanner(true)}
									className="gap-2 text-white/55 hover:bg-white/10 hover:text-white"
								>
									<ScanLine className="w-4 h-4" />
									Scan QR
								</Button>
							</div>
						</div>

						{!cocoMode && cashuStatus === 'initializing' && (
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
								onClick={handleReceive}
								disabled={isReceiving || !token.trim() || (!cocoMode && cashuStatus === 'initializing')}
							>
								{isReceiving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Receive
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
