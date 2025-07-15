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
import { ChevronDown, Loader2, Zap } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

interface ZapDialogProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	event: NDKEvent | NDKUser
	onZapComplete?: (zapEvent?: NDKEvent) => void
}

export function ZapDialog({ isOpen, onOpenChange, event, onZapComplete }: ZapDialogProps) {
	const [amount, setAmount] = useState<number>(21)
	const [zapMessage, setZapMessage] = useState<string>('Zap from Plebeian')
	const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState<boolean>(false)
	const [isAnonymousZap, setIsAnonymousZap] = useState<boolean>(false)
	const [showPaymentProcessor, setShowPaymentProcessor] = useState<boolean>(false)

	// Extract recipient information
	const recipientPubkey = event instanceof NDKUser ? event.pubkey : event.pubkey

	// Fetch profile data if needed
	const { data: profileData, isLoading: isLoadingProfile } = useQuery({
		queryKey: profileKeys.details(recipientPubkey),
		queryFn: () => fetchProfileByIdentifier(recipientPubkey),
		enabled: isOpen, // Only fetch when dialog is open
	})

	// Try to get profile from the event first, then fallback to fetched profile
	const profile = (event instanceof NDKUser ? event.profile : event.author?.profile) || profileData

	const recipientName = profile?.displayName || profile?.name || 'Unknown User'
	const lightningAddress = profile?.lud16 || profile?.lud06 || null

	// Create payment data for the processor
	const paymentData: LightningPaymentData = useMemo(
		() => ({
			amount,
			description: zapMessage,
			recipient: event,
			isZap: true,
		}),
		[amount, zapMessage, event],
	)

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(e.target.value, 10)
		if (!isNaN(value) && value > 0) {
			setAmount(value)
		}
	}

	const handleAmountButtonClick = (presetAmount: number) => {
		setAmount(presetAmount)
		if (!showPaymentProcessor) {
			setShowPaymentProcessor(true)
		}
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
		setAmount(21)
		setZapMessage('Zap from Plebeian')
		setAdvancedSettingsOpen(false)
		setIsAnonymousZap(false)
		setShowPaymentProcessor(false)
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
			<DialogContent className="max-w-[425px]">
				<DialogHeader>
					<DialogTitle>
						Zap {recipientName} {lightningAddress && <small>({lightningAddress})</small>}
					</DialogTitle>
					<DialogDescription>
						Amount: <span className="font-bold">{amount} sats</span>
					</DialogDescription>
				</DialogHeader>

				{/* Amount Selection */}
				<div className="grid grid-cols-2 gap-2 mb-4">
					{DEFAULT_ZAP_AMOUNTS.map(({ displayText, amount: presetAmount }) => (
						<Button
							key={presetAmount}
							variant={amount === presetAmount ? 'tertiary' : 'outline'}
							className="border-2 border-black"
							onClick={() => handleAmountButtonClick(presetAmount)}
						>
							{displayText}
						</Button>
					))}
				</div>

				{/* Message Input */}
				<Label htmlFor="zapMessage" className="font-bold mt-4">
					Message
				</Label>
				<Input
					id="zapMessage"
					type="text"
					value={zapMessage}
					onChange={(e) => setZapMessage(e.target.value)}
					className="border-2 border-black"
				/>

				{/* Advanced Settings */}
				<Collapsible open={advancedSettingsOpen} onOpenChange={setAdvancedSettingsOpen}>
					<CollapsibleTrigger asChild>
						<Button variant="outline" className="w-full mb-2">
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
								onChange={(e) => {
									handleAmountChange(e)
									if (!showPaymentProcessor && parseInt(e.target.value) > 0) {
										setShowPaymentProcessor(true)
									}
								}}
								className="border-2 border-black"
								min={0}
							/>

							<Label htmlFor="isAnonymousZap" className="font-bold">
								Anonymous zap
							</Label>
							<Switch id="isAnonymousZap" checked={isAnonymousZap} onCheckedChange={setIsAnonymousZap} className="border-2 border-black" />
						</div>
					</CollapsibleContent>
				</Collapsible>

				{/* Payment Processor Section */}
				{lightningAddress ? (
					<Collapsible open={showPaymentProcessor} onOpenChange={setShowPaymentProcessor}>
						<CollapsibleTrigger asChild>
							<Button variant="outline" className="w-full mb-2">
								<Zap className="mr-2 h-4 w-4" />
								{showPaymentProcessor ? 'Hide Payment Options' : 'Show Payment Options'}
								<ChevronDown className="ml-2 h-4 w-4" />
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<div className="mt-4">
								<LightningPaymentProcessor
									data={paymentData}
									onPaymentComplete={handlePaymentComplete}
									onPaymentFailed={handlePaymentFailed}
									showManualVerification={true}
								/>
							</div>
						</CollapsibleContent>
					</Collapsible>
				) : (
					<div className="text-center py-8 text-muted-foreground">
						<p>No Lightning address found</p>
						<p className="text-sm">The creator needs to set up a Lightning address in their profile to receive zaps.</p>
					</div>
				)}

				<DialogFooter className="sm:justify-between">
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
