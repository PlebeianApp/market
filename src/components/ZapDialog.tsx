import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_ZAP_AMOUNTS } from '@/lib/constants'
import { ndkActions } from '@/lib/stores/ndk'
import { copyToClipboard } from '@/lib/utils'
import {
	NDKEvent,
	NDKSubscription,
	NDKSubscriptionCacheUsage,
	NDKZapper,
	type NDKPaymentConfirmationLN,
	NDKUser,
	type LnPaymentInfo,
	type NDKZapDetails,
} from '@nostr-dev-kit/ndk'
import { ChevronDown, Copy, Loader2, Wallet, Zap } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface ZapDialogProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent | NDKUser
	onZapComplete?: (zapEvent?: NDKEvent) => void
}

export function ZapDialog({ isOpen, onOpenChange, event, onZapComplete }: ZapDialogProps) {
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

	const subscribeToZapReceipts = useCallback(() => {
		const ndk = ndkActions.getNDK()
		if (!ndk) return null

		startTimeRef.current = Math.floor(Date.now() / 1000)

		const eOrPToFilter = event instanceof NDKEvent ? { '#e': [event.id] } : { '#p': [event.pubkey] }

		const filter = {
			kinds: [9735],
			...eOrPToFilter,
			since: startTimeRef.current - 5,
		}

		const sub = ndk.subscribe(filter, {
			closeOnEose: false,
			cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
		})

		sub.on('event', (zapEvent: NDKEvent) => {
			setPaymentComplete(true)
			setPaymentPending(false)

			if (resolvePaymentRef.current) {
				const confirmation: NDKPaymentConfirmationLN = {
					preimage: zapEvent.tags.find((t) => t[0] === 'preimage')?.[1] || 'unknown',
				}
				resolvePaymentRef.current(confirmation)
				resolvePaymentRef.current = null
			}

			onZapComplete?.(zapEvent)
			toast.success('Zap successful! 🤙')

			setTimeout(() => {
				onOpenChange(false)
				sub.stop()
			}, 1500)
		})

		return sub
	}, [event, onZapComplete, onOpenChange])

	const generateInvoice = async () => {
		try {
			setLoading(true)
			setInvoice(null)
			setErrorMessage(null)
			setPaymentPending(false)
			setPaymentComplete(false)

			const ndk = ndkActions.getNDK()
			if (!ndk) throw new Error('NDK not available')

			const sub = subscribeToZapReceipts()
			zapSubscriptionRef.current = sub

			const lnPay = async (payment: NDKZapDetails<LnPaymentInfo>) => {
				setInvoice(payment.pr)
				setLoading(false)
				setPaymentPending(true)

				return new Promise<NDKPaymentConfirmationLN>((resolve) => {
					resolvePaymentRef.current = resolve
				})
			}

			const zapper = new NDKZapper(event, amount * 1000, 'msats', {
				comment: zapMessage,
				lnPay,
			})

			await zapper.zap()
		} catch (error) {
			console.error('Failed to generate invoice:', error)
			setErrorMessage('Failed to generate invoice: ' + (error instanceof Error ? error.message : 'Unknown error'))
			setLoading(false)
			setInvoice(null)
			cleanupSubscription()
		}
	}

	const handlePaymentComplete = () => {
		if (!resolvePaymentRef.current) return

		setPaymentComplete(true)
		setPaymentPending(false)

		toast.success('Payment marked as complete! Waiting for confirmation...')

		setTimeout(() => {
			if (resolvePaymentRef.current) {
				const confirmation: NDKPaymentConfirmationLN = {
					preimage: 'manual-confirm-' + Math.random().toString(36).substring(2, 8),
				}
				resolvePaymentRef.current(confirmation)
				resolvePaymentRef.current = null

				onZapComplete?.()
				onOpenChange(false)
				cleanupSubscription()
			}
		}, 10000)
	}

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(e.target.value, 10)
		if (!isNaN(value) && value > 0) {
			setAmount(value)
		}
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
								disabled={loading}
							/>
						</div>
					</CollapsibleContent>
				</Collapsible>

				{loading && (
					<div className="w-full flex justify-center mt-4">
						<Loader2 className="h-8 w-8 animate-spin text-primary" />
					</div>
				)}

				{!loading && !errorMessage && (
					<div className="flex flex-row gap-2 mt-4 w-full">
						<Button variant="primary" onClick={generateInvoice} disabled={loading || !zapperReady} className="flex-grow">
							<Zap className="h-4 w-4 mr-2" />
							<span>Zap with QR</span>
						</Button>
						<Button variant="primary" disabled={loading} className="flex-grow">
							<Wallet className="h-4 w-4 mr-2" />
							<span>Zap with NWC</span>
						</Button>
					</div>
				)}

				{invoice && renderInvoiceQR()}

				<DialogFooter className="sm:justify-between">
					<DialogClose asChild>
						<Button type="button" variant="secondary">
							Cancel
						</Button>
					</DialogClose>
					{invoice && !paymentComplete && (
						<Button type="button" onClick={handlePaymentComplete} disabled={paymentComplete}>
							I've Paid
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
