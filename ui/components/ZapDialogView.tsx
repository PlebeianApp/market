import type { ChangeEvent, ReactNode } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { Button } from '../primitives/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Switch } from '../primitives/switch'

export interface ZapRecipientSupport {
	canReceiveZaps: boolean
	hasNip57: boolean
	hasNip61: boolean
}

export interface ZapAmountPreset {
	displayText: string
	amount: number
}

export type ZapDialogStep = 'amount' | 'generateInvoice'

/** Parses the amount field; null when it is empty or not a positive integer. */
export function parseZapAmount(amount: string): number | null {
	const value = parseInt(amount, 10)
	return !isNaN(value) && value > 0 ? value : null
}

export interface ZapDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	isLoading: boolean
	recipientName: string
	lightningAddress: string
	step: ZapDialogStep
	presets: readonly ZapAmountPreset[]
	/** Raw amount field value; digits only. */
	amount: string
	onAmountChange: (amount: string) => void
	zapMessage: string
	onZapMessageChange: (message: string) => void
	isAnonymous: boolean
	onAnonymousChange: (anonymous: boolean) => void
	support: ZapRecipientSupport
	hasNip60Wallet: boolean
	hasNwc: boolean
	isSubmittingNutzap: boolean
	onSendNutzap: () => void
	onContinueToPayment: () => void
	/** Rendered on the invoice step when the recipient supports NIP-57. */
	renderPaymentProcessor: () => ReactNode
}

function zapMethodHint(support: ZapRecipientSupport, hasNwc: boolean): string {
	if (!support.canReceiveZaps) return 'This user does not advertise zap methods.'
	if (!support.hasNip57) return 'Lightning zaps are unavailable for this user. Nutzap may still be available.'
	return hasNwc
		? 'Lightning zap available — you can pay via NIP-60, NWC, WebLN, or QR in the next step.'
		: 'Lightning zap available — you can pay via NIP-60, WebLN, or QR in the next step.'
}

export function ZapDialogView({
	open,
	onOpenChange,
	isLoading,
	recipientName,
	lightningAddress,
	step,
	presets,
	amount,
	onAmountChange,
	zapMessage,
	onZapMessageChange,
	isAnonymous,
	onAnonymousChange,
	support,
	hasNip60Wallet,
	hasNwc,
	isSubmittingNutzap,
	onSendNutzap,
	onContinueToPayment,
	renderPaymentProcessor,
}: ZapDialogViewProps) {
	const numericAmount = parseZapAmount(amount)
	const isValidAmount = numericAmount !== null
	const effectiveZapMessage = isAnonymous ? '' : zapMessage
	const canProceedToPayment = isValidAmount && support.hasNip57
	const canSendNutzap = isValidAmount && hasNip60Wallet && support.hasNip61 && !isSubmittingNutzap

	if (open && isLoading) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-[425px]">
					<DialogHeader>
						<DialogTitle>Loading Zap Information...</DialogTitle>
					</DialogHeader>
					<div className="flex justify-center items-center py-8">
						<Loader2 className="w-8 h-8 animate-spin" />
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[425px]">
				<DialogHeader>
					<DialogTitle>
						Zap {recipientName} {lightningAddress && <small>({lightningAddress})</small>}
					</DialogTitle>
					<DialogDescription className="sr-only">Send a lightning zap to {recipientName}</DialogDescription>
				</DialogHeader>

				{step === 'amount' && (
					<div className="space-y-4">
						<div className="py-2">
							<div className="space-y-2">
								<Label className="font-bold">Amount</Label>
								<div className="gap-2 grid grid-cols-3">
									{presets.map(({ displayText, amount: presetAmount }) => (
										<Button
											key={presetAmount}
											variant={numericAmount === presetAmount ? 'default' : 'outline'}
											onClick={() => onAmountChange(presetAmount.toString())}
										>
											{displayText}
										</Button>
									))}
								</div>
							</div>
						</div>

						<div className="py-2">
							<div className="space-y-2">
								<Label htmlFor="zapMessage" className="font-bold">
									Message
								</Label>
								<Input
									id="zapMessage"
									type="text"
									value={zapMessage}
									onChange={(event: ChangeEvent<HTMLInputElement>) => onZapMessageChange(event.target.value)}
									className="w-full"
								/>
							</div>
						</div>

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
										// Keep only digits so pasted values like "1,000" still work.
										onChange={(event: ChangeEvent<HTMLInputElement>) => onAmountChange(event.target.value.replace(/\D/g, ''))}
										inputMode="numeric"
										pattern="[0-9]*"
										className="w-full"
										placeholder="Enter amount in sats"
									/>
									{!isValidAmount && amount !== '' && <span className="text-red-500 text-sm">Please enter a valid amount</span>}
									{amount === '' && <span className="text-red-500 text-sm">Amount is required</span>}
								</div>

								<div className="flex justify-between items-center gap-4">
									<Label htmlFor="isAnonymousZap" className="font-bold">
										Anonymous zap
									</Label>
									<Switch id="isAnonymousZap" checked={isAnonymous} onCheckedChange={onAnonymousChange} />
								</div>
							</div>
						</div>

						<div className="py-2">
							<div className="flex flex-col gap-2">
								{hasNip60Wallet && support.hasNip61 && (
									<Button onClick={onSendNutzap} className="w-full" variant="secondary" disabled={!canSendNutzap}>
										{isSubmittingNutzap ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Zap className="mr-2 w-4 h-4" />}
										Zap with Nutzap (NIP-60)
									</Button>
								)}
								<Button onClick={onContinueToPayment} className="w-full" disabled={!canProceedToPayment}>
									<Zap className="mr-2 w-4 h-4" />
									Continue to payment
								</Button>
							</div>
							<div className="mt-2 text-muted-foreground text-xs">{zapMethodHint(support, hasNwc)}</div>
						</div>
					</div>
				)}

				{step === 'generateInvoice' && (
					<>
						<div className="mb-4 text-center">
							<p className="font-medium text-sm">
								Amount: <span className="font-bold">{numericAmount ?? '0'} sats</span>
							</p>
							{effectiveZapMessage && <p className="mt-1 text-muted-foreground text-sm">Message: "{effectiveZapMessage}"</p>}
						</div>

						{support.hasNip57 ? (
							<div className="w-full overflow-hidden">{renderPaymentProcessor()}</div>
						) : (
							<div className="py-8 text-muted-foreground text-center">
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
