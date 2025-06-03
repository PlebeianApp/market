import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_ZAP_AMOUNTS } from '@/lib/constants'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { walletStore } from '@/lib/stores/wallet'
import { copyToClipboard } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
	NDKEvent,
	NDKPrivateKeySigner,
	NDKRelaySet,
	NDKSubscription,
	NDKUser,
	NDKZapper,
	type LnPaymentInfo,
	type NDKPaymentConfirmationLN,
	type NDKZapDetails,
} from '@nostr-dev-kit/ndk'
import { NDKNWCWallet, NDKWalletStatus } from '@nostr-dev-kit/ndk-wallet'
import { ChevronDown, Copy, Loader2, QrCodeIcon, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useStore } from '@tanstack/react-store'
import type { NDKState } from '@/lib/stores/ndk'
import type { WalletState } from '@/lib/stores/wallet'

interface ZapDialogProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent | NDKUser
	onZapComplete?: (zapEvent?: NDKEvent) => void
}

export function ZapDialog({ isOpen, onOpenChange, event, onZapComplete }: ZapDialogProps) {
	// Reactive store state

	const ndkState = useStore<NDKState>(ndkStore)
	const walletState = useStore<WalletState>(walletStore)

	const [amount, setAmount] = useState<number>(21)
	const [loading, setLoading] = useState<boolean>(false)
	const [invoice, setInvoice] = useState<string | null>(null)
	const [lightningAddress, setLightningAddress] = useState<string | null>(null)
	const [zapperReady, setZapperReady] = useState<boolean>(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [paymentPending, setPaymentPending] = useState<boolean>(false)
	const [paymentComplete, setPaymentComplete] = useState<boolean>(false)
	const [zapMessage, setZapMessage] = useState<string>('Zap from Plebeian')
	const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState<boolean>(false)
	const [isAnonymousZap, setIsAnonymousZap] = useState<boolean>(false)
	const [nwcZapLoading, setNwcZapLoading] = useState<boolean>(false)

	const zapSubscriptionRef = useRef<NDKSubscription | null>(null)
	const startTimeRef = useRef<number>(0)
	const resolvePaymentRef = useRef<((value: NDKPaymentConfirmationLN) => void) | null>(null)

	useEffect(() => {
		if (isOpen && event) {
			setZapperReady(true)
		} else {
			resetState()
		}

		return () => {
			cleanupSubscription()
		}
	}, [isOpen, event])

	const resetState = () => {
		setInvoice(null)
		setPaymentPending(false)
		setPaymentComplete(false)
		setErrorMessage(null)
		cleanupSubscription()
		resolvePaymentRef.current = null
	}

	const cleanupSubscription = () => {
		if (zapSubscriptionRef.current) {
			zapSubscriptionRef.current.stop()
			zapSubscriptionRef.current = null
		}
	}

	const handleZapSuccess = useCallback(
		(zapReceiptEvent?: NDKEvent) => {
			setPaymentComplete(true)
			setPaymentPending(false)
			setLoading(false)
			setNwcZapLoading(false)

			if (resolvePaymentRef.current && zapReceiptEvent) {
				const confirmation: NDKPaymentConfirmationLN = {
					preimage: zapReceiptEvent.tags.find((t) => t[0] === 'preimage')?.[1] || 'unknown',
				}
				resolvePaymentRef.current(confirmation)
				resolvePaymentRef.current = null
			}

			onZapComplete?.(zapReceiptEvent)
			toast.success('Zap successful! 🤙')

			setTimeout(() => {
				onOpenChange(false)
				cleanupSubscription()
			}, 1500)
		},
		[onZapComplete, onOpenChange],
	)

	const subscribeToZapReceipts = useCallback(() => {
		const ndk = ndkActions.getNDK()
		if (!ndk) return null

		const explicitRelays = ndkStore.state.explicitRelayUrls
		let relaySet: NDKRelaySet | undefined = undefined
		if (explicitRelays && explicitRelays.length > 0) {
			relaySet = NDKRelaySet.fromRelayUrls(explicitRelays, ndk)
		}

		startTimeRef.current = Math.floor(Date.now() / 1000)

		const isEventZap = event instanceof NDKEvent
		const pTag = isEventZap ? event.tags.find((t) => t[0] === 'p')?.[1] : event.pubkey
		const eTag = isEventZap ? event.id : undefined

		const filterTags: Record<string, string[]> = {}
		if (pTag) filterTags['#p'] = [pTag]
		if (eTag) filterTags['#e'] = [eTag]

		const filter = {
			kinds: [9735],
			...filterTags,
			since: startTimeRef.current - 5,
		}

		const sub = ndk.subscribe(filter, {
			closeOnEose: false,
			relaySet: relaySet,
		})

		sub.on('event', (zapReceiptEvent: NDKEvent) => {
			const descriptionTag = zapReceiptEvent.tags.find((t) => t[0] === 'description')?.[1]
			let isOurZap = false

			if (descriptionTag) {
				try {
					const originalZapRequest = JSON.parse(descriptionTag)
					const eventToMatch = event instanceof NDKEvent ? event.id : event.pubkey
					const targetIdentifier = event instanceof NDKEvent ? 'e' : 'p'

					isOurZap = originalZapRequest.tags?.some((tag: string[]) => tag[0] === targetIdentifier && tag[1] === eventToMatch)
					if (
						!isOurZap &&
						event instanceof NDKEvent &&
						originalZapRequest.tags?.some((tag: string[]) => tag[0] === 'a' && tag[1]?.includes(event.id))
					) {
						isOurZap = true
					}
				} catch (error) {
					console.error('Failed to parse original zap request from description tag:', error)
				}
			}

			const isRecentZap = zapReceiptEvent.created_at && zapReceiptEvent.created_at >= startTimeRef.current - 10 // 10s window

			if (isOurZap || isRecentZap) {
				handleZapSuccess(zapReceiptEvent)
			}
		})

		return sub
	}, [event, handleZapSuccess])

	const generateInvoice = async () => {
		setLoading(true)
		setErrorMessage(null)
		setInvoice(null)
		setPaymentComplete(false)
		setPaymentPending(false)

		const ndk = ndkActions.getNDK()
		if (!ndk) {
			setErrorMessage('NDK not initialized.')
			setLoading(false)
			return
		}

		let originalNdkWallet = ndk.wallet
		try {
			ndk.wallet = undefined

			const zapAmountMsats = amount * 1000
			let originalSigner = ndk.signer

			const zapper = new NDKZapper(event, zapAmountMsats, 'msats', {
				comment: zapMessage,
				lnPay: async (paymentInfo: NDKZapDetails<LnPaymentInfo>) => {
					setInvoice(paymentInfo.pr)
					let lud16: string | null = null
					if (event instanceof NDKUser) {
						lud16 = event.profile?.lud16 || event.profile?.lud06 || null
					} else if (event instanceof NDKEvent) {
						// For events, profile might be on event.author
					}
					setLightningAddress(lud16)
					setLoading(false)
					setPaymentPending(true)

					const sub = subscribeToZapReceipts()
					if (!sub) {
						throw new Error('Failed to subscribe to zap receipts for QR flow.')
					}
					zapSubscriptionRef.current = sub

					return new Promise<NDKPaymentConfirmationLN>((resolve) => {
						resolvePaymentRef.current = resolve
					})
				},
			})

			if (!zapper.ndk.signer && !isAnonymousZap) {
				zapper.ndk.signer = NDKPrivateKeySigner.generate()
			}

			if (isAnonymousZap && originalSigner) {
				ndk.signer = undefined
			}

			await zapper.zap()

			if (isAnonymousZap) {
				ndk.signer = originalSigner
			}
		} catch (error) {
			console.error('Zap (QR) generation or payment confirmation failed:', error)
			const errMessage = error instanceof Error ? error.message : String(error)
			setErrorMessage(`Zap (QR) failed: ${errMessage}`)
			toast.error(`Zap (QR) failed: ${errMessage}`)
			setLoading(false)
			setPaymentPending(false)
			cleanupSubscription()
		} finally {
			ndk.wallet = originalNdkWallet
		}
	}

	const handleNwcZap = async () => {
		setNwcZapLoading(true)
		setErrorMessage(null)
		setInvoice(null)
		setPaymentPending(true)
		setPaymentComplete(false)

		const ndk = ndkActions.getNDK()
		const activeNwcUri = ndkState.activeNwcWalletUri

		if (!ndk) {
			setErrorMessage('NDK not initialized.')
			setNwcZapLoading(false)
			return
		}

		if (!activeNwcUri) {
			setErrorMessage('No active NWC wallet selected. Please select one in account settings.')
			setNwcZapLoading(false)
			toast.info('No active NWC wallet selected.')
			return
		}

		let originalNdkWallet = ndk.wallet
		let nwcWalletForZap: NDKNWCWallet | undefined

		try {
			nwcWalletForZap = new NDKNWCWallet(ndk, { pairingCode: activeNwcUri })
			ndk.wallet = nwcWalletForZap

			if (nwcWalletForZap.status !== NDKWalletStatus.READY) {
				setPaymentPending(true)
				await new Promise<void>((resolve, reject) => {
					const readyTimeout = setTimeout(() => reject(new Error('NWC wallet connection timed out.')), 20000)
					nwcWalletForZap!.once('ready', () => {
						clearTimeout(readyTimeout)
						resolve()
					})
				})
			}

			const zapAmountMsats = amount * 1000

			let originalSigner = ndk.signer
			try {
				if (isAnonymousZap) {
					ndk.signer = undefined
				}
				const zapper = new NDKZapper(event, zapAmountMsats, 'msats', {
					comment: zapMessage,
				})

				zapper.on('complete', () => {
					console.log("NDKZapper reported 'complete' for NWC zap. Waiting for kind 9735 receipt.")
				})

				const sub = subscribeToZapReceipts()
				if (!sub) {
					throw new Error('Failed to subscribe to zap receipts for NWC flow.')
				}
				zapSubscriptionRef.current = sub
				setPaymentPending(true)

				const zapDetails = await zapper.zap()
				if (zapDetails instanceof Map && zapDetails.size > 0) {
					const firstValue = zapDetails.values().next().value
					if (firstValue && typeof firstValue === 'object' && firstValue.hasOwnProperty('preimage')) {
						handleZapSuccess()
						return
					}
				}
			} finally {
				if (isAnonymousZap) {
					ndk.signer = originalSigner
				}
			}
		} catch (error) {
			console.error('NWC Zap failed:', error)
			const errMessage = error instanceof Error ? error.message : String(error)
			setErrorMessage(`NWC Zap failed: ${errMessage}`)
			toast.error(`NWC Zap failed: ${errMessage}`)
			setNwcZapLoading(false)
			setPaymentPending(false)
			cleanupSubscription()
		} finally {
			if (ndk) ndk.wallet = originalNdkWallet
		}
	}

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(e.target.value, 10)
		if (!isNaN(value) && value > 0) {
			setAmount(value)
		}
	}

	const handleManualPaymentConfirmation = () => {
		setPaymentComplete(true)
		setPaymentPending(false)
		setLoading(false)
		setNwcZapLoading(false)

		if (resolvePaymentRef.current) {
			const mockConfirmation: NDKPaymentConfirmationLN = {
				preimage: `manual-confirm-${Date.now()}`,
			}
			resolvePaymentRef.current(mockConfirmation)
			resolvePaymentRef.current = null
		}

		onZapComplete?.() // Call without event
		toast.info('Payment marked as complete. Closing dialog.') // Using info to differentiate from auto-confirmed

		setTimeout(() => {
			onOpenChange(false)
			cleanupSubscription()
		}, 1500)
	}

	const renderLoading = () => (
		<div className="flex flex-col items-center justify-center py-8">
			<Loader2 className="h-8 w-8 animate-spin text-primary" />
			<p className="mt-2 text-sm text-muted-foreground">Loading payment information...</p>
		</div>
	)

	const renderError = () => (
		<div className="py-6">
			<p className="text-red-500">{errorMessage}</p>
			<p className="text-sm text-muted-foreground mt-2">
				The creator needs to set up a Lightning address in their profile to receive zaps.
			</p>
		</div>
	)

	const renderInvoiceQR = () => (
		<div className="flex flex-col items-center space-y-4">
			<div className="bg-white p-6 rounded-lg">
				<QRCodeSVG value={invoice || ''} size={240} level="H" includeMargin={true} className="mx-auto" />
			</div>
			<div className="flex flex-col w-full space-y-2">
				<p className="text-center text-sm mb-2">Scan with your Lightning wallet</p>
				<div className="flex items-center">
					<Input value={invoice || ''} readOnly className="font-mono text-xs" />
					<Button
						variant="ghost"
						size="icon"
						onClick={() => invoice && copyToClipboard(invoice)}
						className="ml-2"
						title="Copy to clipboard"
					>
						<Copy className="h-4 w-4" />
					</Button>
				</div>
				{lightningAddress && <p className="text-sm text-center text-muted-foreground mt-1">Zap to: {lightningAddress}</p>}
				{paymentPending && !paymentComplete && (
					<p className="text-sm text-center text-amber-500 mt-2 animate-pulse">Waiting for payment...</p>
				)}
				{paymentComplete && <p className="text-sm text-center text-green-500 mt-2">Payment detected! Processing zap...</p>}
			</div>
		</div>
	)

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Zap {lightningAddress && <small>({lightningAddress})</small>}</DialogTitle>
					<DialogDescription>
						Amount: <span className="font-bold">{amount} sats</span>
					</DialogDescription>
				</DialogHeader>

				<div className="grid grid-cols-2 gap-2 mb-4">
					{DEFAULT_ZAP_AMOUNTS.map(({ displayText, amount: presetAmount }) => (
						<Button
							key={presetAmount}
							variant={amount === presetAmount ? 'tertiary' : 'outline'}
							className="border-2 border-black"
							onClick={() => setAmount(presetAmount)}
							disabled={loading}
						>
							{displayText}
						</Button>
					))}
				</div>

				<Label htmlFor="zapMessage" className="font-bold mt-4">
					Message
				</Label>
				<Input
					id="zapMessage"
					type="text"
					value={zapMessage}
					onChange={(e) => setZapMessage(e.target.value)}
					className="border-2 border-black"
					disabled={loading}
				/>

				<Collapsible open={advancedSettingsOpen} onOpenChange={setAdvancedSettingsOpen}>
					<CollapsibleTrigger asChild>
						<Button variant="outline" className="w-full mb-2" disabled={loading}>
							Advanced Settings
							<ChevronDown className="ml-2 h-4 w-4" />
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="space-y-2 mt-2 flex flex-col">
							<Label htmlFor="zapAmount" className="font-bold">
								Manual zap amount
							</Label>
							<Input
								id="zapAmount"
								type="number"
								value={amount}
								onChange={handleAmountChange}
								className="border-2 border-black"
								min={0}
								disabled={loading}
							/>

							<Label htmlFor="isAnonymousZap" className="font-bold">
								Anonymous zap
							</Label>
							<Switch
								id="isAnonymousZap"
								checked={isAnonymousZap}
								onCheckedChange={setIsAnonymousZap}
								className="border-2 border-black"
								disabled={loading || nwcZapLoading}
							/>
						</div>
					</CollapsibleContent>
				</Collapsible>

				{loading && (
					<div className="w-full flex justify-center mt-4">
						<Loader2 className="h-8 w-8 animate-spin text-primary" />
					</div>
				)}

				{!loading && !errorMessage && !invoice && (
					<div className="flex flex-row gap-2 mt-4 w-full">
						<Button
							variant="primary"
							onClick={handleNwcZap}
							disabled={nwcZapLoading || paymentPending || !ndkState.activeNwcWalletUri || walletState.isLoading}
							className="flex-grow"
						>
							{nwcZapLoading || (paymentPending && !invoice) ? (
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							) : walletState.isLoading ? (
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							) : (
								<Wallet className="h-4 w-4 mr-2" />
							)}
							<span>{walletState.isLoading ? 'Loading...' : !ndkState.activeNwcWalletUri ? 'No wallet' : 'Zap with NWC'}</span>
						</Button>
						<Button variant="outline" onClick={generateInvoice} disabled={loading || paymentPending} className="flex-grow">
							{loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <QrCodeIcon className="h-4 w-4 mr-2" />}
							<span>Zap with QR</span>
						</Button>
					</div>
				)}

				{errorMessage && renderError()}
				{invoice && !errorMessage && renderInvoiceQR()}

				<DialogFooter className="sm:justify-between">
					<DialogClose asChild>
						<Button type="button" variant="secondary">
							Cancel
						</Button>
					</DialogClose>
					{invoice && !paymentComplete && (
						<Button type="button" onClick={handleManualPaymentConfirmation} disabled={paymentPending && paymentComplete}>
							I've Paid
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
