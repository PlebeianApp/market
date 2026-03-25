import { LightningPaymentProcessor, type LightningPaymentData, type PaymentResult } from '@/components/lightning/LightningPaymentProcessor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_ZAP_AMOUNTS } from '@/lib/constants'
import { useNDK } from '@/lib/stores/ndk'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { Loader2, Zap } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

interface ZapDialogProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent | NDKUser
	onZapComplete?: (zapEvent?: NDKEvent) => void
}

interface RecipientZapSupport {
	canReceiveZaps: boolean
	hasNip57: boolean
	hasNip61: boolean
}

const EMPTY_ZAP_SUPPORT: RecipientZapSupport = {
	canReceiveZaps: false,
	hasNip57: false,
	hasNip61: false,
}

export function ZapDialog({ isOpen, onOpenChange, event, onZapComplete }: ZapDialogProps) {
	const [amount, setAmount] = useState<string>('21')
	const [zapMessage, setZapMessage] = useState<string>('Zap from Plebeian')
	const [isAnonymousZap, setIsAnonymousZap] = useState<boolean>(false)
	const [isSubmittingNutzap, setIsSubmittingNutzap] = useState<boolean>(false)
	const [step, setStep] = useState<'amount' | 'generateInvoice'>('amount')
	const [paymentSessionId, setPaymentSessionId] = useState(0)

	// NDK state for NWC functionality
	const ndkState = useNDK()
	const nip60State = useStore(nip60Store)

	// Extract recipient information
	const recipientPubkey = event instanceof NDKUser ? event.pubkey : event.pubkey

	// Fetch profile data if needed
	const { data: profileData, isLoading: isLoadingProfile } = useQuery({
		queryKey: profileKeys.details(recipientPubkey),
		queryFn: () => fetchProfileByIdentifier(recipientPubkey),
		enabled: isOpen, // Only fetch when dialog is open
	})

	// Fetch recipient zap methods (NIP-57/NIP-61)
	const { data: recipientZapSupport = EMPTY_ZAP_SUPPORT, isLoading: isLoadingZapSupport } = useQuery({
		queryKey: [...profileKeys.zapCapability(recipientPubkey), 'methods'],
		queryFn: async (): Promise<RecipientZapSupport> => {
			if (!ndkState.ndk) return EMPTY_ZAP_SUPPORT

			const baseUser = event instanceof NDKUser ? event : event.author
			const userToZap = baseUser?.ndk ? baseUser : await ndkState.ndk.fetchUser(recipientPubkey)
			if (!userToZap) return EMPTY_ZAP_SUPPORT

			const zapInfo = await userToZap.getZapInfo()
			return {
				canReceiveZaps: zapInfo.size > 0,
				hasNip57: zapInfo.has('nip57'),
				hasNip61: zapInfo.has('nip61'),
			}
		},
		enabled: isOpen && !!ndkState.ndk,
	})

	// Try to get profile from the event first, then fallback to fetched profile
	const eventProfile = event instanceof NDKUser ? event.profile : event.author?.profile
	const fetchedProfile = profileData?.profile || null
	const profile = eventProfile || fetchedProfile

	const recipientName = profile?.displayName || profile?.name || 'Unknown User'
	const lightningAddress = profile?.lud16 || profile?.lud06 || ''
	const hasNip60Wallet = nip60State.status === 'ready' && !!nip60State.wallet
	const effectiveZapMessage = isAnonymousZap ? '' : zapMessage

	// Check if NWC is available
	const hasNwc = !!ndkState.activeNwcWalletUri

	// Parse amount to number, handle empty/invalid values
	const numericAmount = parseInt(amount, 10)
	const isValidAmount = !isNaN(numericAmount) && numericAmount > 0
	const canProceedToPayment = isValidAmount && recipientZapSupport.hasNip57
	const canSendNutzap = isValidAmount && hasNip60Wallet && recipientZapSupport.hasNip61 && !isSubmittingNutzap

	// Create payment data for the processor
	const paymentData: LightningPaymentData = useMemo(
		() => ({
			invoiceId: `zap-${recipientPubkey}-${paymentSessionId}`,
			amount: isValidAmount ? numericAmount : 0,
			description: effectiveZapMessage,
			recipient: event,
			isZap: true,
			monitorZapReceipt: true,
		}),
		[numericAmount, effectiveZapMessage, event, isValidAmount, recipientPubkey, paymentSessionId],
	)

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		// Keep only digits so paste/input methods like "1,000" still work.
		const digitsOnly = e.target.value.replace(/\D/g, '')
		setAmount(digitsOnly)
	}

	const handleAmountButtonClick = (presetAmount: number) => {
		setAmount(presetAmount.toString())
	}

	const handlePaymentComplete = useCallback(
		(result: PaymentResult) => {
			console.log('Zap payment completed:', result)
			onZapComplete?.()
			toast.success('Zap successful! 🤙')

			setTimeout(() => {
				onOpenChange(false)
			}, 1500)
		},
		[onZapComplete, onOpenChange],
	)

	const handlePaymentFailed = useCallback((result: PaymentResult) => {
		console.error('Zap payment failed:', result)
		toast.error(`Zap failed: ${result.error}`)
	}, [])

	const handleSendNutzap = useCallback(async () => {
		if (!isValidAmount) {
			toast.error('Please enter a valid zap amount')
			return
		}
		if (!hasNip60Wallet) {
			toast.error('NIP-60 wallet is required for nutzaps')
			return
		}
		if (!recipientZapSupport.hasNip61) {
			toast.error('This user does not accept nutzaps')
			return
		}

		setIsSubmittingNutzap(true)
		try {
			const result = await nip60Actions.zapWithNutzap({
				target: event,
				amountSats: numericAmount,
				comment: effectiveZapMessage || undefined,
			})

			onZapComplete?.(result.event)
			toast.success('Nutzap sent! ⚡')
			setTimeout(() => onOpenChange(false), 800)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Failed to send nutzap'
			console.error('Nutzap failed:', error)
			toast.error(`Nutzap failed: ${errorMessage}`)
		} finally {
			setIsSubmittingNutzap(false)
		}
	}, [isValidAmount, hasNip60Wallet, recipientZapSupport.hasNip61, event, numericAmount, effectiveZapMessage, onZapComplete, onOpenChange])

	const resetState = () => {
		setAmount('21')
		setZapMessage('Zap from Plebeian')
		setIsAnonymousZap(false)
		setIsSubmittingNutzap(false)
		setStep('amount')
		setPaymentSessionId((id) => id + 1)
	}

	const handleDialogOpenChange = (open: boolean) => {
		if (!open) {
			resetState()
		}
		onOpenChange(open)
	}

	const handleContinueToPayment = () => {
		if (!isValidAmount) {
			toast.error('Please enter a valid zap amount')
			return
		}

		if (!recipientZapSupport.hasNip57) {
			toast.error('This user does not accept Lightning zaps')
			return
		}

		setPaymentSessionId((id) => id + 1)
		setStep('generateInvoice')
	}

	// Show loading state while profile/zap support is being fetched
	if (isOpen && (isLoadingProfile || isLoadingZapSupport)) {
		return (
			<Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
				<DialogContent className="max-w-[425px]">
					<DialogHeader>
						<DialogTitle>Loading Zap Information...</DialogTitle>
					</DialogHeader>
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-8 w-8 animate-spin" />
						<span className="ml-2">Fetching zap data...</span>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="secondary">
								Cancel
							</Button>
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		)
	}

	return (
		<Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
			<DialogContent className="max-w-[425px]">
				<DialogHeader>
					<DialogTitle>
						Zap {recipientName} {lightningAddress && <small>({lightningAddress})</small>}
					</DialogTitle>
					<DialogDescription className="sr-only">Send a lightning zap to {recipientName}</DialogDescription>
				</DialogHeader>

				{step === 'amount' && (
					<div className="space-y-4">
						{/* Amount Selection */}
						<div className="py-2">
							<div className="space-y-2">
								<Label className="font-bold">Amount</Label>
								<div className="grid grid-cols-3 gap-2">
									{DEFAULT_ZAP_AMOUNTS.map(({ displayText, amount: presetAmount }) => (
										<Button
											key={presetAmount}
											variant={numericAmount === presetAmount ? 'focus' : 'outline'}
											className={numericAmount === presetAmount ? 'border-2' : 'border-2 border-black'}
											onClick={() => handleAmountButtonClick(presetAmount)}
										>
											{displayText}
										</Button>
									))}
								</div>
							</div>
						</div>

						{/* Message Input */}
						<div className="py-2">
							<div className="space-y-2">
								<Label htmlFor="zapMessage" className="font-bold">
									Message
								</Label>
								<Input id="zapMessage" type="text" value={zapMessage} onChange={(e) => setZapMessage(e.target.value)} className="w-full" />
							</div>
						</div>

						{/* Advanced Settings */}
						<div className="py-2">
							<div className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="zapAmount" className="font-bold">
										Manual zap amount
									</Label>
									<Input
										id="zapAmount"
										type="text"
										value={amount}
										onChange={handleAmountChange}
										inputMode="numeric"
										pattern="[0-9]*"
										className="w-full"
										placeholder="Enter amount in sats"
									/>
									{!isValidAmount && amount !== '' && <span className="text-red-500 text-sm">Please enter a valid amount</span>}
									{amount === '' && <span className="text-red-500 text-sm">Amount is required</span>}
								</div>

								<div className="flex items-center justify-between gap-4">
									<Label htmlFor="isAnonymousZap" className="font-bold">
										Anonymous zap
									</Label>
									<Switch id="isAnonymousZap" checked={isAnonymousZap} onCheckedChange={setIsAnonymousZap} />
								</div>
							</div>
						</div>

						{/* Footer */}
						<div className="py-2">
							<div className="flex flex-col gap-2">
								{hasNip60Wallet && recipientZapSupport.hasNip61 && (
									<Button onClick={handleSendNutzap} className="w-full" variant="secondary" disabled={!canSendNutzap}>
										{isSubmittingNutzap ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
										Zap with Nutzap (NIP-60)
									</Button>
								)}
								<Button onClick={handleContinueToPayment} className="w-full" variant="focus" disabled={!canProceedToPayment}>
									<Zap className="mr-2 h-4 w-4" />
									Continue to payment
								</Button>
							</div>
							<div className="text-xs text-muted-foreground mt-2">
								{!recipientZapSupport.canReceiveZaps
									? 'This user does not advertise zap methods.'
									: !recipientZapSupport.hasNip57
										? 'Lightning zaps are unavailable for this user. Nutzap may still be available.'
										: hasNwc
											? 'Lightning zap available — you can pay via NIP-60, NWC, WebLN, or QR in the next step.'
											: 'Lightning zap available — you can pay via NIP-60, WebLN, or QR in the next step.'}
							</div>
						</div>
					</div>
				)}

				{step === 'generateInvoice' && (
					<>
						{/* Amount and Message Info */}
						<div className="text-center mb-4">
							<p className="text-sm font-medium">
								Amount: <span className="font-bold">{isValidAmount ? numericAmount : '0'} sats</span>
							</p>
							{effectiveZapMessage && <p className="text-sm text-muted-foreground mt-1">Message: "{effectiveZapMessage}"</p>}
						</div>

						{/* Payment Processor Section */}
						{recipientZapSupport.hasNip57 ? (
							<div className="w-full overflow-hidden">
								<LightningPaymentProcessor
									key={paymentSessionId}
									data={paymentData}
									onPaymentComplete={handlePaymentComplete}
									onPaymentFailed={handlePaymentFailed}
									showManualVerification={true}
								/>
							</div>
						) : (
							<div className="text-center py-8 text-muted-foreground">
								<p>Lightning zap method unavailable</p>
								<p className="text-sm">This user does not advertise a NIP-57 zap endpoint.</p>
							</div>
						)}
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
