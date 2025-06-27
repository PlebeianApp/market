import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { QRCode } from '@/components/ui/qr-code'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, Copy, Zap, ExternalLink, RefreshCw, AlertTriangle, Timer, Wallet, CreditCard, Users, Clock } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { copyToClipboard } from '@/lib/utils'
import { toast } from 'sonner'

export interface PaymentMethod {
	type: 'lightning' | 'bitcoin' | 'nwc'
	details: string
	label: string
	icon?: React.ReactNode
}

export interface PaymentDetail {
	id: string
	paymentMethod: string
	isDefault: boolean
	paymentDetails: string
	stallId?: string | null
}

export interface InvoicePaymentData {
	id: string
	sellerPubkey: string
	sellerName?: string
	amountSats: number
	bolt11?: string
	expiresAt?: number
	status: 'pending' | 'processing' | 'paid' | 'expired' | 'failed'
	type: 'merchant' | 'v4v'
	description?: string
}

export interface PaymentProcessorProps {
	// Single invoice mode
	paymentDetail?: PaymentDetail
	amountSats?: number
	paymentType?: string // 'merchant' or pubkey for v4v

	// Multi-invoice mode
	invoices?: InvoicePaymentData[]

	// Common props
	onPaymentComplete?: (details: PaymentEventDetails) => void
	onPaymentExpired?: (details: PaymentEventDetails) => void
	onPaymentCancelled?: (details: PaymentEventDetails) => void
	onInvoicePayment?: (invoiceId: string, method: 'lightning' | 'nwc') => void
	disabled?: boolean
	dialogMode?: boolean
}

export interface PaymentEventDetails {
	paymentRequest?: string
	proof?: string
	amountSats: number
	paymentType: string
	invoiceId?: string
}

// Single Invoice Payment Component
function SingleInvoicePayment({
	invoice,
	onPayment,
	onComplete,
	onExpired,
}: {
	invoice: InvoicePaymentData
	onPayment?: (invoiceId: string, method: 'lightning' | 'nwc') => void
	onComplete?: (details: PaymentEventDetails) => void
	onExpired?: (details: PaymentEventDetails) => void
}) {
	const [paymentMethod, setPaymentMethod] = useState<'lightning' | 'nwc'>('lightning')
	const [copySuccess, setCopySuccess] = useState(false)
	const [timeLeft, setTimeLeft] = useState<number | null>(null)
	const [isProcessing, setIsProcessing] = useState(false)

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	const formatTime = (seconds: number): string => {
		const minutes = Math.floor(seconds / 60)
		const remainingSeconds = seconds % 60
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
	}

	// Handle expiration countdown
	useEffect(() => {
		if (!invoice.expiresAt) return

		const updateTimer = () => {
			const now = Date.now()
			const remaining = Math.max(0, Math.floor((invoice.expiresAt! - now) / 1000))
			setTimeLeft(remaining)

			if (remaining === 0 && invoice.status === 'pending') {
				onExpired?.({
					paymentRequest: invoice.bolt11,
					amountSats: invoice.amountSats,
					paymentType: invoice.type,
					invoiceId: invoice.id,
				})
			}
		}

		updateTimer()
		const interval = setInterval(updateTimer, 1000)
		return () => clearInterval(interval)
	}, [invoice.expiresAt, invoice.status, invoice.bolt11, invoice.amountSats, invoice.type, invoice.id, onExpired])

	const handleCopyToClipboard = async () => {
		if (!invoice.bolt11) return
		await copyToClipboard(invoice.bolt11)
		setCopySuccess(true)
		toast.success('Invoice copied to clipboard')
		setTimeout(() => setCopySuccess(false), 2000)
	}

	const handleLightningPayment = () => {
		if (!invoice.bolt11) return

		// Try to open in wallet
		const url = `lightning:${invoice.bolt11}`
		const link = document.createElement('a')
		link.href = url
		link.click()

		onPayment?.(invoice.id, 'lightning')
	}

	const handleNWCPayment = async () => {
		setIsProcessing(true)
		try {
			// Simulate NWC payment process
			await new Promise((resolve) => setTimeout(resolve, 2000))

			onPayment?.(invoice.id, 'nwc')
			onComplete?.({
				paymentRequest: invoice.bolt11,
				proof: 'nwc_' + Math.random().toString(36).substring(2, 10),
				amountSats: invoice.amountSats,
				paymentType: invoice.type,
				invoiceId: invoice.id,
			})

			toast.success('NWC payment initiated')
		} catch (error) {
			toast.error('NWC payment failed')
		} finally {
			setIsProcessing(false)
		}
	}

	const isExpired = timeLeft === 0
	const isNearExpiry = timeLeft && timeLeft < 300 // Less than 5 minutes

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{invoice.type === 'v4v' ? <Users className="w-5 h-5 text-purple-600" /> : <CreditCard className="w-5 h-5 text-green-600" />}
						<span className="text-lg">{invoice.type === 'v4v' ? 'V4V Payment' : 'Merchant Payment'}</span>
						<Badge variant={invoice.status === 'paid' ? 'secondary' : 'outline'}>
							{invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
						</Badge>
					</div>
					<div className="text-right">
						<div className="text-sm text-gray-500">Amount</div>
						<div className="font-bold">{formatSats(invoice.amountSats)} sats</div>
					</div>
				</CardTitle>
			</CardHeader>

			<CardContent className="space-y-4">
				{/* Timer */}
				{timeLeft !== null && timeLeft > 0 && (
					<div
						className={`flex items-center gap-2 p-2 rounded ${isNearExpiry ? 'bg-orange-50 text-orange-800' : 'bg-blue-50 text-blue-800'}`}
					>
						<Clock className="w-4 h-4" />
						<span className="text-sm">Expires in: {formatTime(timeLeft)}</span>
						<Progress value={Math.max(0, (timeLeft / 3600) * 100)} className="flex-1 h-2" />
					</div>
				)}

				{/* Status Messages */}
				{invoice.status === 'paid' && (
					<div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded">
						<Check className="w-5 h-5" />
						<span>Payment completed successfully!</span>
					</div>
				)}

				{isExpired && (
					<div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded">
						<AlertTriangle className="w-4 h-4" />
						<span>This invoice has expired</span>
					</div>
				)}

				{/* Payment Method Selection */}
				{invoice.status === 'pending' && !isExpired && (
					<Tabs value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as 'lightning' | 'nwc')}>
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="lightning" className="flex items-center gap-2">
								<Zap className="w-4 h-4" />
								Lightning
							</TabsTrigger>
							<TabsTrigger value="nwc" className="flex items-center gap-2">
								<Wallet className="w-4 h-4" />
								NWC
							</TabsTrigger>
						</TabsList>

						<TabsContent value="lightning" className="space-y-3">
							{invoice.bolt11 && (
								<>
									{/* QR Code */}
									<div className="flex justify-center">
										<QRCode
											value={invoice.bolt11}
											size={200}
											title="Lightning Payment"
											description="Scan with your Lightning wallet"
											showBorder={false}
											level="M"
										/>
									</div>

									{/* Invoice String */}
									<div className="bg-gray-50 p-3 rounded">
										<div className="flex items-center gap-2">
											<code className="text-xs font-mono flex-1 break-all">{invoice.bolt11}</code>
											<Button variant="outline" size="sm" onClick={handleCopyToClipboard}>
												{copySuccess ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
											</Button>
										</div>
									</div>

									{/* Lightning Actions */}
									<div className="space-y-2">
										<Button onClick={handleLightningPayment} className="w-full">
											<ExternalLink className="w-4 h-4 mr-2" />
											Open in Wallet
										</Button>
									</div>
								</>
							)}
						</TabsContent>

						<TabsContent value="nwc" className="space-y-3">
							<div className="text-center space-y-3">
								<div className="p-8 bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg">
									<Wallet className="w-12 h-12 mx-auto text-blue-600 mb-3" />
									<h3 className="font-medium mb-2">Pay with Nostr Wallet Connect</h3>
									<p className="text-sm text-gray-600 mb-4">Pay instantly using your connected Nostr wallet</p>
									<Button onClick={handleNWCPayment} disabled={isProcessing} className="w-full">
										{isProcessing ? (
											<>
												<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
												Processing...
											</>
										) : (
											<>
												<Zap className="w-4 h-4 mr-2" />
												Pay {formatSats(invoice.amountSats)} sats
											</>
										)}
									</Button>
								</div>
							</div>
						</TabsContent>
					</Tabs>
				)}
			</CardContent>
		</Card>
	)
}

// Multi-Invoice Payment Component
function MultiInvoicePayment({
	invoices,
	onInvoicePayment,
	onPaymentComplete,
	onPaymentExpired,
}: {
	invoices: InvoicePaymentData[]
	onInvoicePayment?: (invoiceId: string, method: 'lightning' | 'nwc') => void
	onPaymentComplete?: (details: PaymentEventDetails) => void
	onPaymentExpired?: (details: PaymentEventDetails) => void
}) {
	const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState(0)

	const totalAmount = invoices.reduce((sum, inv) => sum + inv.amountSats, 0)
	const paidInvoices = invoices.filter((inv) => inv.status === 'paid')
	const completionPercentage = (paidInvoices.length / invoices.length) * 100

	const handleNextInvoice = () => {
		if (currentInvoiceIndex < invoices.length - 1) {
			setCurrentInvoiceIndex(currentInvoiceIndex + 1)
		}
	}

	const handlePreviousInvoice = () => {
		if (currentInvoiceIndex > 0) {
			setCurrentInvoiceIndex(currentInvoiceIndex - 1)
		}
	}

	const currentInvoice = invoices[currentInvoiceIndex]

	return (
		<div className="space-y-6">
			{/* Progress Overview */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<span>Payment Progress</span>
						<Badge variant="secondary">
							{paidInvoices.length}/{invoices.length} Complete
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<Progress value={completionPercentage} className="h-3" />
					<div className="grid grid-cols-2 gap-4 text-sm">
						<div>
							<div className="text-gray-600">Total Amount</div>
							<div className="font-semibold">{totalAmount.toLocaleString()} sats</div>
						</div>
						<div>
							<div className="text-gray-600">Remaining</div>
							<div className="font-semibold">{invoices.length - paidInvoices.length} invoices</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Navigation */}
			<div className="flex items-center justify-between">
				<Button variant="outline" onClick={handlePreviousInvoice} disabled={currentInvoiceIndex === 0}>
					Previous
				</Button>
				<span className="text-sm text-gray-600">
					Invoice {currentInvoiceIndex + 1} of {invoices.length}
				</span>
				<Button variant="outline" onClick={handleNextInvoice} disabled={currentInvoiceIndex === invoices.length - 1}>
					Next
				</Button>
			</div>

			{/* Current Invoice */}
			<SingleInvoicePayment
				invoice={currentInvoice}
				onPayment={onInvoicePayment}
				onComplete={onPaymentComplete}
				onExpired={onPaymentExpired}
			/>

			{/* Invoice List Overview */}
			<Card>
				<CardHeader>
					<CardTitle>All Invoices</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-2">
						{invoices.map((invoice, index) => (
							<div
								key={invoice.id}
								className={`flex items-center justify-between p-3 rounded border cursor-pointer transition-colors ${
									index === currentInvoiceIndex ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
								}`}
								onClick={() => setCurrentInvoiceIndex(index)}
							>
								<div className="flex items-center gap-3">
									{invoice.type === 'v4v' ? (
										<Users className="w-4 h-4 text-purple-600" />
									) : (
										<CreditCard className="w-4 h-4 text-green-600" />
									)}
									<div>
										<div className="font-medium">{invoice.type === 'v4v' ? 'V4V Payment' : 'Merchant Payment'}</div>
										<div className="text-sm text-gray-600">{invoice.sellerName || invoice.sellerPubkey.substring(0, 8)}...</div>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<span className="font-medium">{invoice.amountSats.toLocaleString()} sats</span>
									{invoice.status === 'paid' && <Check className="w-4 h-4 text-green-600" />}
									{invoice.status === 'failed' && <AlertTriangle className="w-4 h-4 text-red-600" />}
									{invoice.status === 'pending' && <Clock className="w-4 h-4 text-yellow-600" />}
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

export function PaymentProcessor({
	paymentDetail,
	amountSats,
	paymentType,
	invoices,
	onPaymentComplete,
	onPaymentExpired,
	onPaymentCancelled,
	onInvoicePayment,
	disabled = false,
	dialogMode = false,
}: PaymentProcessorProps) {
	const [isDialogOpen, setIsDialogOpen] = useState(false)

	// Legacy single payment mode
	if (paymentDetail && amountSats && paymentType) {
		const legacyInvoice: InvoicePaymentData = {
			id: Math.random().toString(36).substring(2),
			sellerPubkey: 'legacy',
			amountSats,
			status: 'pending',
			type: paymentType === 'merchant' ? 'merchant' : 'v4v',
		}

		const content = (
			<SingleInvoicePayment
				invoice={legacyInvoice}
				onPayment={onInvoicePayment}
				onComplete={onPaymentComplete}
				onExpired={onPaymentExpired}
			/>
		)

		if (dialogMode) {
			return (
				<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
					<DialogTrigger asChild>
						<Button disabled={disabled}>
							<CreditCard className="w-4 h-4 mr-2" />
							Make Payment
						</Button>
					</DialogTrigger>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle>Payment</DialogTitle>
						</DialogHeader>
						{content}
					</DialogContent>
				</Dialog>
			)
		}

		return content
	}

	// Multi-invoice mode
	if (invoices && invoices.length > 0) {
		const content = (
			<MultiInvoicePayment
				invoices={invoices}
				onInvoicePayment={onInvoicePayment}
				onPaymentComplete={onPaymentComplete}
				onPaymentExpired={onPaymentExpired}
			/>
		)

		if (dialogMode) {
			return (
				<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
					<DialogTrigger asChild>
						<Button disabled={disabled || invoices.every((inv) => inv.status === 'paid')}>
							<CreditCard className="w-4 h-4 mr-2" />
							Pay Invoices ({invoices.length})
						</Button>
					</DialogTrigger>
					<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>Payment Center</DialogTitle>
						</DialogHeader>
						{content}
					</DialogContent>
				</Dialog>
			)
		}

		return content
	}

	// Fallback
	return (
		<Card className="opacity-50">
			<CardContent className="p-4">
				<div className="text-center text-gray-500">No payment data provided</div>
			</CardContent>
		</Card>
	)
}

// Utility function to trigger NWC payment (for compatibility with working project)
export const triggerNWCPayment = async (bolt11: string) => {
	console.log('Triggering NWC payment for invoice:', bolt11)
	return new Promise((resolve) => setTimeout(resolve, 1000))
}
