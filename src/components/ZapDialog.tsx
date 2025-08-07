import { LightningPaymentProcessor, type LightningPaymentData, type PaymentResult } from '@/components/lightning/LightningPaymentProcessor'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_ZAP_AMOUNTS } from '@/lib/constants'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Loader2, X, Zap } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

interface ZapDialogProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent | NDKUser
	onZapComplete?: (zapEvent?: NDKEvent) => void
}

type DialogStep = 'main' | 'generateInvoice'

export function ZapDialog({ isOpen, onOpenChange, event, onZapComplete }: ZapDialogProps) {
	const [amount, setAmount] = useState<string>('21')
	const [zapMessage, setZapMessage] = useState<string>('Zap from Plebeian')
	const [isAnonymousZap, setIsAnonymousZap] = useState<boolean>(false)
	const [step, setStep] = useState<DialogStep>('main')

	// Extract recipient information
	const recipientPubkey = event instanceof NDKUser ? event.pubkey : event.pubkey

	// Fetch profile data if needed
	const { data: profileData, isLoading: isLoadingProfile } = useQuery({
		queryKey: profileKeys.details(recipientPubkey),
		queryFn: () => fetchProfileByIdentifier(recipientPubkey),
		enabled: isOpen, // Only fetch when dialog is open
	})

	// Try to get profile from the event first, then fallback to fetched profile
	const profile = (event instanceof NDKUser ? event.profile : event.author?.profile) || profileData?.profile

	const recipientName = profile?.displayName || profile?.name || 'Unknown User'
	const lightningAddress = profile?.lud16 || profile?.lud06 || null

	// Parse amount to number, handle empty/invalid values
	const numericAmount = parseInt(amount, 10)
	const isValidAmount = !isNaN(numericAmount) && numericAmount > 0

	// Create payment data for the processor
	const paymentData: LightningPaymentData = useMemo(
		() => ({
			amount: isValidAmount ? numericAmount : 0,
			description: zapMessage,
			recipient: event,
			isZap: true,
		}),
		[numericAmount, zapMessage, event, isValidAmount],
	)

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value
		// Allow empty string or valid numbers
		if (value === '' || /^\d+$/.test(value)) {
			setAmount(value)
		}
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

	const resetState = () => {
		setAmount('21')
		setZapMessage('Zap from Plebeian')
		setIsAnonymousZap(false)
		setStep('main')
	}

	const handleDialogOpenChange = (open: boolean) => {
		if (!open) {
			resetState()
		}
		onOpenChange(open)
	}

	// Show loading state while profile is being fetched
	if (isOpen && isLoadingProfile) {
		return (
			<Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
				<DialogContent className="max-w-[425px]">
					<DialogHeader>
						<DialogTitle>Loading Zap Information...</DialogTitle>
					</DialogHeader>
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-8 w-8 animate-spin" />
						<span className="ml-2">Fetching profile data...</span>
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
			<DialogContent className="max-w-[425px] w-[95vw] max-h-[90vh] overflow-y-auto [&>button]:hidden">
				<DialogHeader className="sr-only">
					<DialogTitle>Zap {recipientName}</DialogTitle>
				</DialogHeader>
				{/* Custom Header with three columns */}
				<div className="flex items-center justify-between pb-4">
					{/* Left: Back button (only visible on generateInvoice step) */}
					<div className="flex items-center w-8">
						{step === 'generateInvoice' && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setStep('main')}
								className="h-8 w-8 p-0"
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
						)}
					</div>

					{/* Center: Profile name and address */}
					<div className="flex-1 text-center px-2 min-w-0">
						<h2 className="text-base font-semibold truncate">
							Zap {recipientName}
						</h2>
						{lightningAddress && (
							<p className="text-sm text-muted-foreground truncate">
								{lightningAddress}
							</p>
						)}
					</div>

					{/* Right: Close button */}
					<div className="flex items-center w-8">
						<DialogClose asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-8 w-8 p-0"
							>
								<X className="h-4 w-4" />
							</Button>
						</DialogClose>
					</div>
				</div>

				{step === 'main' && (
					<div>
						{/* Amount Selection */}
						<div className="py-2">
							<div className="grid grid-cols-2 gap-2">
								{DEFAULT_ZAP_AMOUNTS.map(({ displayText, amount: presetAmount }) => (
									<Button
										key={presetAmount}
										variant={numericAmount === presetAmount ? 'tertiary' : 'outline'}
										className="text-sm"
										onClick={() => handleAmountButtonClick(presetAmount)}
									>
										{displayText}
									</Button>
								))}
							</div>
						</div>

						{/* Message Input */}
						<div className="py-2">
							<div className="space-y-2">
								<Label htmlFor="zapMessage" className="font-bold">
									Message
								</Label>
								<Input
									id="zapMessage"
									type="text"
									value={zapMessage}
									onChange={(e) => setZapMessage(e.target.value)}
									className="w-full"
								/>
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

						{/* No lightning address message */}
						{!lightningAddress && (
							<div className="py-2">
								<div className="text-center text-muted-foreground">
									<p>No Lightning address found</p>
									<p className="text-sm">The creator needs to set up a Lightning address in their profile to receive zaps.</p>
								</div>
							</div>
						)}

						{/* Footer */}
						{lightningAddress && (
							<div className="py-2">
								<Button onClick={() => setStep('generateInvoice')} className="w-full" variant="focus">
									<Zap className="mr-2 h-4 w-4" />
									Generate Invoice
								</Button>
							</div>
						)}
					</div>
				)}

				{step === 'generateInvoice' && (
					<>
						{/* Amount and Message Info */}
						<div className="text-center mb-4">
							<p className="text-sm font-medium">
								Amount: <span className="font-bold">{isValidAmount ? numericAmount : '0'} sats</span>
							</p>
							{zapMessage && (
								<p className="text-sm text-muted-foreground mt-1">
									Message: "{zapMessage}"
								</p>
							)}
						</div>

						<div className="w-full overflow-hidden">
							<LightningPaymentProcessor
								data={paymentData}
								onPaymentComplete={handlePaymentComplete}
								onPaymentFailed={handlePaymentFailed}
								showManualVerification={true}
							/>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
