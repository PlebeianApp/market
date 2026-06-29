import { useEffect, useState } from 'react'
import { SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Nip60Wallet } from '@/feature/wallet/components/Nip60Wallet'
import { Button } from '@/components/ui/button'
import { useStore } from '@tanstack/react-store'
import { uiStore } from '@/lib/stores/ui'
import { nip60Store, nip60Actions } from '@/lib/stores/nip60'
import { cashuStore, cashuActions } from '@/lib/stores/cashu'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, Check, Copy, Zap, QrCode, Send, ScanLine, ArrowLeft } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'

type WalletPage = 'wallet' | 'manageMints' | 'proofs' | 'deposit' | 'withdraw' | 'send' | 'receive'

const PAGE_TITLES: Record<WalletPage, string> = {
	wallet: 'Wallet',
	deposit: 'Deposit Lightning',
	withdraw: 'Withdraw to Lightning',
	send: 'Send eCash',
	receive: 'Receive eCash',
	manageMints: 'Manage Mints',
	proofs: 'Proofs',
}

const walletSheetClassName =
	'flex h-dvh max-h-dvh w-[100vw] flex-col gap-0 overflow-hidden p-0 sm:w-[85vw] sm:max-w-none md:w-[55vw] xl:w-[35vw]'

export default function WalletSheetContent() {
	const [page, setPage] = useState<WalletPage>('wallet')
	const walletPage = useStore(uiStore, (state) => state.walletPage)

	const { mints, depositInvoice, depositStatus, balance: nip60Balance, mintBalances } = useStore(nip60Store)
	const { status: cashuStatus, balances: cashuBalances } = useStore(cashuStore)

	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [copied, setCopied] = useState(false)
	const [view, setView] = useState<'form' | 'token'>('form')
	const [generatedToken, setGeneratedToken] = useState<string | null>(null)
	const [isWithdrawing, setIsWithdrawing] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (walletPage) {
			if (walletPage === 'mints' || walletPage === 'manageMints') setPage('manageMints')
			else if (walletPage === 'proofs') setPage('proofs')
			else if (walletPage === 'deposit') setPage('deposit')
			else if (walletPage === 'withdraw') setPage('withdraw')
			else if (walletPage === 'send') setPage('send')
			else if (walletPage === 'receive') setPage('receive')
			else setPage('wallet')
		}
	}, [walletPage])

	const goBack = () => setPage('wallet')

	return (
		<SheetContent side="right" className={walletSheetClassName}>
			<SheetHeader className="shrink-0 pr-12">
				<div className="flex items-center gap-2">
					{page !== 'wallet' && (
						<Button variant="ghost" size="icon" className="-ml-1 shrink-0" onClick={goBack}>
							<ArrowLeft className="w-4 h-4" />
						</Button>
					)}
					<div className="flex-1 min-w-0">
						<SheetTitle className="text-xl">{PAGE_TITLES[page]}</SheetTitle>
						<SheetDescription className="hidden">Manage your Cashu wallet</SheetDescription>
					</div>
				</div>
			</SheetHeader>

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{page === 'wallet' ? (
					<div className="flex-1 overflow-y-auto flex flex-col">
						<div className="my-auto pt-1 pb-8 px-4 w-full">
							<Nip60Wallet />
						</div>
					</div>
				) : (
					<ScrollArea className="flex-1">
						<div className="mx-auto max-w-lg p-4">
							{page === 'deposit' && (
								<div className="space-y-4">
									<div>
										<p className="text-sm text-muted-foreground">Generate a Lightning invoice to mint eCash</p>
									</div>

									{depositStatus === 'success' ? (
										<div className="py-6 text-center">
											<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
												<Check className="w-6 h-6 text-green-600" />
											</div>
											<p className="text-lg font-medium text-green-600">Deposit Successful!</p>
											<p className="text-sm text-muted-foreground mt-2">Your eCash has been minted</p>
											<div className="flex justify-end mt-4">
												<Button onClick={goBack}>Done</Button>
											</div>
										</div>
									) : depositInvoice ? (
										<div className="space-y-4">
											<div className="flex justify-center">
												<div className="p-4 bg-white rounded-lg">
													<QRCodeSVG value={depositInvoice} size={200} />
												</div>
											</div>
											<div className="space-y-2">
												<p className="text-sm font-medium">Lightning Invoice</p>
												<div className="flex gap-2">
													<input
														type="text"
														value={depositInvoice}
														readOnly
														className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono truncate"
													/>
													<Button
														variant="outline"
														size="icon"
														onClick={async () => {
															try {
																await navigator.clipboard.writeText(depositInvoice)
																setCopied(true)
																toast.success('Invoice copied to clipboard')
																setTimeout(() => setCopied(false), 2000)
															} catch {
																toast.error('Failed to copy invoice')
															}
														}}
													>
														{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
													</Button>
												</div>
											</div>
											<p className="text-sm text-muted-foreground text-center">Waiting for payment...</p>
											<div className="flex justify-center">
												<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
											</div>
											<div className="flex justify-end gap-2">
												<Button
													variant="outline"
													onClick={() => {
														nip60Actions.cancelDeposit()
														goBack()
													}}
												>
													Cancel
												</Button>
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
												/>
											</div>
											<div className="space-y-2">
												<label className="text-sm font-medium">Mint</label>
												<select
													value={selectedMint}
													onChange={(e) => setSelectedMint(e.target.value)}
													className="w-full px-3 py-2 text-sm border rounded-md bg-background"
												>
													{mints.map((mint) => (
														<option key={mint} value={mint}>
															{new URL(mint).hostname}
														</option>
													))}
												</select>
											</div>
											{depositStatus === 'error' && (
												<p className="text-sm text-destructive">Failed to generate invoice. Please try again.</p>
											)}
											<div className="flex justify-end gap-2">
												<Button variant="outline" onClick={goBack}>
													Cancel
												</Button>
												<Button
													onClick={async () => {
														const amountNum = parseInt(amount, 10)
														if (isNaN(amountNum) || amountNum <= 0) {
															toast.error('Please enter a valid amount')
															return
														}
														if (!selectedMint) {
															toast.error('Please select a mint')
															return
														}
														setIsGenerating(true)
														try {
															await nip60Actions.startDeposit(amountNum, selectedMint)
														} finally {
															setIsGenerating(false)
														}
													}}
													disabled={isGenerating || !amount || !selectedMint}
												>
													{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
													Generate Invoice
												</Button>
											</div>
										</div>
									)}
								</div>
							)}

							{page === 'withdraw' && (
								<div className="space-y-4">
									<div>
										<p className="text-sm text-muted-foreground">
											Pay a Lightning invoice using your eCash (Balance: {nip60Balance.toLocaleString()} sats)
										</p>
									</div>

									{isSuccess ? (
										<div className="py-6 text-center">
											<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
												<Check className="w-6 h-6 text-green-600" />
											</div>
											<p className="text-lg font-medium text-green-600">Withdrawal Successful!</p>
											<p className="text-sm text-muted-foreground mt-2">Your Lightning invoice has been paid</p>
											<div className="flex justify-end mt-4">
												<Button onClick={goBack}>Done</Button>
											</div>
										</div>
									) : showScanner ? (
										<div className="space-y-4">
											<div className="relative w-full aspect-square overflow-hidden rounded-lg">
												<Scanner
													onScan={(codes) => {
														if (codes && codes.length > 0) {
															const result = codes[0].rawValue
															const clean = result.replace(/^lightning:/i, '').trim()
															setAmount(clean)
															setShowScanner(false)
															toast.success('Invoice scanned')
														}
													}}
													onError={() => toast.error('Camera error')}
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
												<label className="text-sm font-medium">From Mint</label>
												<select
													value={selectedMint}
													onChange={(e) => setSelectedMint(e.target.value)}
													className="w-full px-3 py-2 text-sm border rounded-md bg-background"
												>
													{mints
														.filter((mint) => (mintBalances[mint] ?? 0) > 0)
														.map((mint) => (
															<option key={mint} value={mint}>
																{new URL(mint).hostname} ({(mintBalances[mint] ?? 0).toLocaleString()} sats)
															</option>
														))}
												</select>
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">Lightning Invoice</label>
												<textarea
													value={amount}
													onChange={(e) => setAmount(e.target.value)}
													placeholder="lnbc..."
													className="flex-1 w-full px-3 py-2 text-sm border rounded-md bg-background font-mono resize-none h-24"
												/>
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
												<Button variant="outline" onClick={goBack}>
													Cancel
												</Button>
												<Button
													onClick={async () => {
														if (!amount.trim()) {
															toast.error('Please enter a Lightning invoice')
															return
														}
														const normalized = amount.toLowerCase().trim()
														if (!normalized.startsWith('lnbc') && !normalized.startsWith('lightning:')) {
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
															const cashuMintBalance = cashuBalances[selectedMint] ?? 0
															const useCoco = cashuStatus === 'ready' && cashuMintBalance > 0
															const cleanInvoice = amount.replace(/^lightning:/i, '').trim()
															if (useCoco) {
																await cashuActions.melt(selectedMint, cleanInvoice)
															} else {
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
													}}
													disabled={isWithdrawing || !amount.trim() || !selectedMint || cashuStatus === 'initializing'}
												>
													{isWithdrawing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
													Withdraw
												</Button>
											</div>
										</div>
									)}
								</div>
							)}

							{page === 'receive' && (
								<div className="space-y-4">
									<div>
										<p className="text-sm text-muted-foreground">Scan or paste a Cashu token to receive eCash</p>
									</div>

									{isSuccess ? (
										<div className="py-6 text-center">
											<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
												<Check className="w-6 h-6 text-green-600" />
											</div>
											<p className="text-lg font-medium text-green-600">eCash Received!</p>
											<p className="text-sm text-muted-foreground mt-2">The tokens have been added to your wallet</p>
											<div className="flex justify-end mt-4">
												<Button onClick={goBack}>Done</Button>
											</div>
										</div>
									) : showScanner ? (
										<div className="space-y-4">
											<div className="relative w-full aspect-square overflow-hidden rounded-lg">
												<Scanner
													onScan={(codes) => {
														if (codes && codes.length > 0) {
															const result = codes[0].rawValue
															if (result && (result.startsWith('cashuA') || result.startsWith('cashuB'))) {
																setGeneratedToken(result)
																setShowScanner(false)
																toast.success('Token scanned')
															} else if (result) {
																toast.error('Invalid Cashu token')
															}
														}
													}}
													onError={() => toast.error('Camera error')}
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
												<label className="text-sm font-medium">Cashu Token</label>
												<textarea
													value={generatedToken ?? ''}
													onChange={(e) => setGeneratedToken(e.target.value)}
													placeholder="cashuA..."
													className="w-full px-3 py-2 text-sm border rounded-md bg-background font-mono resize-none h-24"
												/>
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
												<Button variant="outline" onClick={goBack}>
													Cancel
												</Button>
												<Button
													onClick={async () => {
														if (!generatedToken || !generatedToken.trim()) {
															toast.error('Please enter a Cashu token')
															return
														}
														const normalizedToken = generatedToken.trim()
														if (!normalizedToken.startsWith('cashuA') && !normalizedToken.startsWith('cashuB')) {
															toast.error('Invalid Cashu token format')
															return
														}
														setIsGenerating(true)
														setError(null)
														try {
															await nip60Actions.receiveEcash(normalizedToken)
															setIsSuccess(true)
															toast.success('eCash received successfully!')
														} catch (err) {
															const message = err instanceof Error ? err.message : 'Failed to receive eCash'
															setError(message)
															toast.error(message)
														} finally {
															setIsGenerating(false)
														}
													}}
													disabled={isGenerating || cashuStatus === 'initializing'}
												>
													{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <QrCode className="w-4 h-4 mr-2" />}
													Receive
												</Button>
											</div>
										</div>
									)}
								</div>
							)}

							{page === 'send' && (
								<div className="space-y-4">
									<div>
										<p className="text-sm text-muted-foreground">
											Generate a Cashu token to send eCash (Balance: {nip60Balance.toLocaleString()} sats)
										</p>
									</div>

									{view === 'token' && generatedToken ? (
										<div className="space-y-4">
											<div className="flex justify-center">
												<div className="p-4 bg-white rounded-lg">
													<QRCodeSVG value={generatedToken} size={200} />
												</div>
											</div>
											<div className="space-y-2">
												<p className="text-sm font-medium">Cashu Token</p>
												<textarea
													value={generatedToken}
													readOnly
													className="flex-1 w-full px-3 py-2 text-sm bg-muted rounded-md font-mono resize-none h-24"
												/>
												<div className="flex justify-end">
													<Button
														variant="outline"
														size="sm"
														onClick={async () => {
															try {
																await navigator.clipboard.writeText(generatedToken as string)
																setCopied(true)
																toast.success('Token copied to clipboard')
																setTimeout(() => setCopied(false), 2000)
															} catch {
																toast.error('Failed to copy token')
															}
														}}
														className="gap-2"
													>
														{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
														{copied ? 'Copied!' : 'Copy Token'}
													</Button>
												</div>
											</div>
											<p className="text-sm text-muted-foreground text-center">
												Share this token with the recipient. It can only be redeemed once.
											</p>
											<p className="text-xs text-muted-foreground text-center">
												Token saved to pending list. You can reclaim it if the recipient doesn't claim it.
											</p>
											<div className="flex justify-end gap-2">
												<Button
													variant="outline"
													onClick={() => {
														setView('form')
														setGeneratedToken(null)
													}}
												>
													Send Another
												</Button>
												<Button onClick={goBack}>Done</Button>
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
													max={nip60Balance}
												/>
											</div>
											{mints.filter((mint) => (mintBalances[mint] ?? 0) > 0).length > 0 && (
												<div className="space-y-2">
													<label className="text-sm font-medium">From Mint</label>
													<select
														value={selectedMint}
														onChange={(e) => setSelectedMint(e.target.value)}
														className="w-full px-3 py-2 text-sm border rounded-md bg-background"
													>
														{mints
															.filter((mint) => (mintBalances[mint] ?? 0) > 0)
															.map((mint) => (
																<option key={mint} value={mint}>
																	{new URL(mint).hostname} ({(mintBalances[mint] ?? 0).toLocaleString()} sats)
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
												<Button variant="outline" onClick={goBack}>
													Cancel
												</Button>
												<Button
													onClick={async () => {
														const amountNum = parseInt(amount, 10)
														if (isNaN(amountNum) || amountNum <= 0) {
															toast.error('Please enter a valid amount')
															return
														}
														const mintBalance = selectedMint ? (mintBalances[selectedMint] ?? 0) : nip60Balance
														if (amountNum > mintBalance) {
															toast.error('Insufficient balance')
															return
														}
														setIsGenerating(true)
														setError(null)
														try {
															const cashuMintBalance = cashuBalances[selectedMint] ?? 0
															const useCoco = cashuStatus === 'ready' && selectedMint && cashuMintBalance >= amountNum
															let token: string | null = null
															if (useCoco) {
																token = await cashuActions.send(selectedMint, amountNum)
															} else {
																token = await nip60Actions.sendEcash(amountNum, selectedMint || undefined)
															}
															if (token) {
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
													}}
													disabled={isGenerating || !amount || !selectedMint || cashuStatus === 'initializing'}
												>
													{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
													Generate Token
												</Button>
											</div>
										</div>
									)}
								</div>
							)}

							{page === 'manageMints' && (
								<div className="space-y-4">
									<p className="text-sm text-muted-foreground">Add, remove, and configure Cashu mints for your wallet.</p>
									<div className="space-y-3">
										{mints.length === 0 ? (
											<p className="text-sm text-muted-foreground">No mints configured.</p>
										) : (
											mints.map((mint) => (
												<div key={mint} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
													<div className="min-w-0">
														<p className="font-medium truncate">{new URL(mint).hostname}</p>
														<p className="text-xs text-muted-foreground truncate">{mint}</p>
														{mintBalances[mint] !== undefined && (
															<p className="text-xs text-muted-foreground mt-0.5">{mintBalances[mint].toLocaleString()} sats</p>
														)}
													</div>
												</div>
											))
										)}
									</div>
									<p className="text-xs text-muted-foreground">Use the Wallet tab to add or remove mints.</p>
								</div>
							)}

							{page === 'proofs' && (
								<div className="space-y-4">
									<p className="text-sm text-muted-foreground">Raw Cashu proofs stored in your wallet.</p>
									<p className="text-xs text-muted-foreground">
										Expand the Proofs section in the Wallet tab to view and manage individual proofs.
									</p>
								</div>
							)}
						</div>
					</ScrollArea>
				)}
			</div>
		</SheetContent>
	)
}
