import { ChevronLeft, ChevronRight, Copy, CreditCard, Loader2, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../primitives/card'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { QRCode } from '../../primitives/qr-code'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../primitives/tooltip'

export interface LightningPaymentViewProps {
	className?: string
	title?: string
	invoice: string | null
	isGeneratingInvoice: boolean
	isPaymentInProgress: boolean
	/** Passively watching for a zap receipt after an external payment. */
	isCheckingForReceipt: boolean
	capabilities: { hasNwc: boolean; hasNip60: boolean; hasWebLn: boolean; canManualVerify: boolean }
	manualPreimage: string
	onManualPreimageChange: (value: string) => void
	onPayNip60: () => void
	onPayNwc: () => void
	onPayWebLn: () => void
	onVerifyPreimage: () => void
	onCopyInvoice: (invoice: string) => void
	/** Shown only when `skippable` is set. */
	onSkip?: () => void
	skippable: boolean
	onCancel?: () => void
	navigation?: { currentIndex: number; total: number; onNavigate: (index: number) => void }
}

function DisabledWithTooltip({ tooltip, children }: { tooltip: string; children: ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="sm:flex-1 w-full">{children}</div>
			</TooltipTrigger>
			<TooltipContent>
				<p>{tooltip}</p>
			</TooltipContent>
		</Tooltip>
	)
}

export function LightningPaymentView({
	className,
	title,
	invoice,
	isGeneratingInvoice,
	isPaymentInProgress,
	isCheckingForReceipt,
	capabilities,
	manualPreimage,
	onManualPreimageChange,
	onPayNip60,
	onPayNwc,
	onPayWebLn,
	onVerifyPreimage,
	onCopyInvoice,
	onSkip,
	skippable,
	onCancel,
	navigation,
}: LightningPaymentViewProps) {
	const canSkip = !!onSkip && skippable
	const showInvoice = !!invoice && !isGeneratingInvoice

	return (
		<TooltipProvider>
			<Card className={className}>
				{title && (
					<CardHeader>
						<CardTitle>{title}</CardTitle>
					</CardHeader>
				)}
				<CardContent className="space-y-6 p-6">
					{(isGeneratingInvoice || isPaymentInProgress) && (
						<div className="flex justify-center items-center py-8">
							<Loader2 className="w-8 h-8 animate-spin" />
							<span className="ml-2">{isGeneratingInvoice ? 'Generating invoice...' : 'Processing payment...'}</span>
						</div>
					)}

					{!invoice && !isGeneratingInvoice && !isPaymentInProgress && (
						<div className="space-y-4 py-4">
							<div className="text-amber-600 text-center">
								<p className="font-medium">Unable to generate Lightning invoice</p>
								<p className="mt-1 text-gray-600 text-sm">
									{skippable
										? 'The recipient may not have Lightning configured. You can skip this payment and pay directly later.'
										: 'The recipient may not have Lightning configured.'}
								</p>
							</div>
							{canSkip && (
								<Button onClick={onSkip} variant="secondary" className="w-full">
									Skip Payment (Pay Later)
								</Button>
							)}
						</div>
					)}

					{showInvoice && (
						<div className="space-y-4">
							<div className="flex justify-center">
								<a
									href={`lightning:${invoice}`}
									className="block hover:opacity-90 transition-opacity"
									target="_blank"
									rel="noopener noreferrer"
								>
									<QRCode value={invoice} size={200} />
								</a>
							</div>

							{navigation && navigation.total > 1 && (
								<div className="sm:hidden flex gap-2 mt-3">
									<Button
										variant="outline"
										className="flex-1"
										onClick={() => navigation.onNavigate(Math.max(0, navigation.currentIndex - 1))}
										disabled={navigation.currentIndex === 0}
									>
										<ChevronLeft className="mr-2 w-4 h-4" />
										Previous
									</Button>
									<Button
										variant="outline"
										className="flex-1"
										onClick={() => navigation.onNavigate(Math.min(navigation.total - 1, navigation.currentIndex + 1))}
										disabled={navigation.currentIndex >= navigation.total - 1}
									>
										Next
										<ChevronRight className="ml-2 w-4 h-4" />
									</Button>
								</div>
							)}

							<div className="space-y-2">
								<Label htmlFor="invoice">Lightning Invoice</Label>
								<div className="flex gap-2">
									<Input id="invoice" value={invoice} readOnly className="font-mono text-xs" />
									<Button variant="outline" size="icon" onClick={() => onCopyInvoice(invoice)}>
										<Copy className="w-4 h-4" />
									</Button>
								</div>
							</div>

							{isCheckingForReceipt && !isPaymentInProgress && (
								<div className="flex justify-center items-center gap-2 text-muted-foreground text-sm">
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Checking for payment…</span>
								</div>
							)}
						</div>
					)}

					{showInvoice && (
						<div className="space-y-3">
							<div className="flex sm:flex-row flex-col sm:flex-wrap gap-2">
								{capabilities.hasNip60 && (
									<Button onClick={onPayNip60} disabled={isPaymentInProgress} className="sm:flex-1 w-full" variant="outline">
										<Zap className="mr-2 w-4 h-4" />
										Pay with NIP-60 Wallet
									</Button>
								)}

								{capabilities.hasNwc ? (
									<Button onClick={onPayNwc} disabled={isPaymentInProgress} className="sm:flex-1 w-full" variant="outline">
										<Zap className="mr-2 w-4 h-4" />
										Pay with NWC
									</Button>
								) : (
									<DisabledWithTooltip tooltip="No NWC wallet connected">
										<Button disabled className="w-full" variant="outline">
											<Zap className="mr-2 w-4 h-4" />
											Pay with NWC
										</Button>
									</DisabledWithTooltip>
								)}

								{capabilities.hasWebLn ? (
									<Button onClick={onPayWebLn} disabled={isPaymentInProgress} className="sm:flex-1 w-full" variant="outline">
										<CreditCard className="mr-2 w-4 h-4" />
										Pay with WebLN
									</Button>
								) : (
									<DisabledWithTooltip tooltip="WebLN not available">
										<Button disabled className="w-full" variant="outline">
											<CreditCard className="mr-2 w-4 h-4" />
											Pay with WebLN
										</Button>
									</DisabledWithTooltip>
								)}
							</div>

							{capabilities.canManualVerify && (
								<div className="space-y-2">
									<Label htmlFor="preimage">Payment Preimage (Manual Verification)</Label>
									<div className="flex gap-2">
										<Input
											id="preimage"
											placeholder="Enter payment preimage"
											value={manualPreimage}
											onChange={(e) => onManualPreimageChange(e.target.value)}
										/>
										<Button onClick={onVerifyPreimage} variant="secondary">
											Verify
										</Button>
									</div>
								</div>
							)}

							{canSkip && (
								<Button onClick={onSkip} variant="outline" className="w-full">
									Pay Later
								</Button>
							)}

							{onCancel && (
								<Button onClick={onCancel} variant="ghost" className="w-full">
									Cancel
								</Button>
							)}
						</div>
					)}
				</CardContent>
			</Card>
		</TooltipProvider>
	)
}
