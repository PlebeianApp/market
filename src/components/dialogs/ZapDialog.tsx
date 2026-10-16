import { LightningPaymentProcessor, type LightningPaymentData, type PaymentResult } from '@/components/lightning/LightningPaymentProcessor'
import { DEFAULT_ZAP_AMOUNTS } from '@/lib/constants'
import { useNDK } from '@/lib/stores/ndk'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys, zapKeys } from '@/queries/queryKeyFactory'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { parseZapAmount, ZapDialogView, type ZapRecipientSupport } from '@ui/components/ZapDialogView'

interface ZapDialogProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent | NDKUser
	onZapComplete?: (zapEvent?: NDKEvent) => void
}

const EMPTY_ZAP_SUPPORT: ZapRecipientSupport = {
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
	const queryClient = useQueryClient()

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
		queryFn: async (): Promise<ZapRecipientSupport> => {
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
	const parsedAmount = parseZapAmount(amount)
	const isValidAmount = parsedAmount !== null
	const numericAmount = parsedAmount ?? 0

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

	const handlePaymentComplete = useCallback(
		(result: PaymentResult) => {
			console.log('Zap payment completed:', result)
			onZapComplete?.()
			toast.success('Zap successful! 🤙')

			// Invalidate zaps query
			const eventId = event instanceof NDKEvent ? event.id : undefined
			queryClient.invalidateQueries({
				queryKey: zapKeys.byProvider(event.pubkey, eventId),
			})

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

	return (
		<ZapDialogView
			open={isOpen}
			onOpenChange={handleDialogOpenChange}
			isLoading={isLoadingProfile || isLoadingZapSupport}
			recipientName={recipientName}
			lightningAddress={lightningAddress}
			step={step}
			presets={DEFAULT_ZAP_AMOUNTS}
			amount={amount}
			onAmountChange={setAmount}
			zapMessage={zapMessage}
			onZapMessageChange={setZapMessage}
			isAnonymous={isAnonymousZap}
			onAnonymousChange={setIsAnonymousZap}
			support={recipientZapSupport}
			hasNip60Wallet={hasNip60Wallet}
			hasNwc={hasNwc}
			isSubmittingNutzap={isSubmittingNutzap}
			onSendNutzap={handleSendNutzap}
			onContinueToPayment={handleContinueToPayment}
			renderPaymentProcessor={() => (
				<LightningPaymentProcessor
					key={paymentSessionId}
					data={paymentData}
					onPaymentComplete={handlePaymentComplete}
					onPaymentFailed={handlePaymentFailed}
					showManualVerification={true}
				/>
			)}
		/>
	)
}
