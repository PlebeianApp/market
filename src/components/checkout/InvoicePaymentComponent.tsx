import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { QRCode } from '@/components/ui/qr-code'
import { Check, Copy, CreditCard, Zap, Clock, ExternalLink, RefreshCw, AlertTriangle, Users } from 'lucide-react'
import { useState, useEffect } from 'react'
import { copyToClipboard } from '@/lib/utils'

export interface LightningInvoiceData {
	id: string
	sellerPubkey: string
	sellerName: string
	amount: number
	bolt11: string // Lightning invoice
	expiresAt?: number
	items: Array<{
		productId: string
		name: string
		amount: number
		price: number
	}>
	status: 'pending' | 'processing' | 'paid' | 'expired' | 'failed'
	invoiceType?: 'seller' | 'v4v'
	originalSellerPubkey?: string // For V4V invoices, tracks which seller's order this relates to
	paymentMethods?: Array<{
		type: 'lightning' | 'bitcoin'
		details: string
		label: string
	}>
}

interface InvoicePaymentComponentProps {
	invoice: LightningInvoiceData
	onPayInvoice: (invoiceId: string) => void
	invoiceNumber: number
	totalInvoices: number
}

export function InvoicePaymentComponent({ invoice, onPayInvoice, invoiceNumber, totalInvoices }: InvoicePaymentComponentProps) {
	const [copySuccess, setCopySuccess] = useState(false)
	const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('lightning')
	const [timeLeft, setTimeLeft] = useState<number | null>(null)
	const [paymentAttempts, setPaymentAttempts] = useState(0)
	const [isRetrying, setIsRetrying] = useState(false)

	// Update timer every second for expiration countdown
	useEffect(() => {
		if (!invoice.expiresAt) return

		const interval = setInterval(() => {
			const now = Math.floor(Date.now() / 1000)
			const remaining = invoice.expiresAt! - now
			setTimeLeft(Math.max(0, remaining))
		}, 1000)

		return () => clearInterval(interval)
	}, [invoice.expiresAt])

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	const formatTime = (seconds: number): string => {
		const minutes = Math.floor(seconds / 60)
		const remainingSeconds = seconds % 60
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
	}

	const handleCopyToClipboard = async (text: string = invoice.bolt11) => {
		await copyToClipboard(text)
		setCopySuccess(true)
		setTimeout(() => setCopySuccess(false), 2000)
	}

	const openInWallet = () => {
		const paymentString =
			selectedPaymentMethod === 'lightning'
				? `lightning:${invoice.bolt11}`
				: selectedPaymentMethod === 'bitcoin'
					? `bitcoin:${invoice.bolt11}`
					: invoice.bolt11
		window.open(paymentString, '_blank')
	}

	const handlePaymentRetry = async () => {
		setIsRetrying(true)
		setPaymentAttempts((prev) => prev + 1)

		// Simulate retry delay
		setTimeout(() => {
			setIsRetrying(false)
			onPayInvoice(invoice.id)
		}, 1000)
	}

	const isExpired = invoice.expiresAt && timeLeft === 0
	const isNearExpiry = timeLeft && timeLeft < 300 // Less than 5 minutes

	// Mock payment methods if not provided
	const paymentMethods = invoice.paymentMethods || [
		{ type: 'lightning' as const, details: invoice.bolt11, label: 'Lightning Network' },
		{ type: 'bitcoin' as const, details: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', label: 'Bitcoin On-chain' },
	]

	const currentPaymentMethod = paymentMethods.find((method) => method.type === selectedPaymentMethod) || paymentMethods[0]

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center gap-3 mb-6">
				<div className={`p-2 rounded-lg ${invoice.invoiceType === 'v4v' ? 'bg-purple-100' : 'bg-green-100'}`}>
					{invoice.invoiceType === 'v4v' ? (
						<Users className="h-5 w-5 text-purple-600" />
					) : (
						<CreditCard className="h-5 w-5 text-green-600" />
					)}
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2">
						<h2 className="text-xl font-semibold">
							Payment {invoiceNumber} of {totalInvoices}
						</h2>
						<Badge variant={invoice.invoiceType === 'v4v' ? 'secondary' : 'outline'}>
							{invoice.invoiceType === 'v4v' ? 'V4V Payment' : 'Merchant Payment'}
						</Badge>
					</div>
					<p className="text-gray-600">Pay {invoice.sellerName}</p>
				</div>

				{/* Progress indicator */}
				<div className="text-right">
					<div className="text-sm text-gray-500 mb-1">
						Progress: {invoiceNumber}/{totalInvoices}
					</div>
					<Progress value={(invoiceNumber / totalInvoices) * 100} className="w-24" />
				</div>
			</div>

			{/* Status Banner */}
			{invoice.status !== 'pending' && (
				<Card
					className={`border-l-4 ${
						invoice.status === 'paid'
							? 'border-green-500 bg-green-50'
							: invoice.status === 'processing'
								? 'border-yellow-500 bg-yellow-50'
								: invoice.status === 'failed'
									? 'border-red-500 bg-red-50'
									: 'border-gray-500 bg-gray-50'
					}`}
				>
					<CardContent className="p-4">
						<div className="flex items-center gap-2">
							{invoice.status === 'paid' && <Check className="w-5 h-5 text-green-600" />}
							{invoice.status === 'processing' && <RefreshCw className="w-5 h-5 text-yellow-600 animate-spin" />}
							{invoice.status === 'failed' && <AlertTriangle className="w-5 h-5 text-red-600" />}
							<span className="font-medium">
								{invoice.status === 'paid' && 'Payment Successful!'}
								{invoice.status === 'processing' && 'Processing Payment...'}
								{invoice.status === 'failed' && 'Payment Failed'}
								{invoice.status === 'expired' && 'Payment Expired'}
							</span>
							{paymentAttempts > 0 && (
								<Badge variant="outline" className="ml-2">
									Attempt {paymentAttempts + 1}
								</Badge>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Expiration Warning */}
			{timeLeft !== null && timeLeft > 0 && (
				<Card className={`${isNearExpiry ? 'border-orange-300 bg-orange-50' : 'border-blue-300 bg-blue-50'}`}>
					<CardContent className="p-4">
						<div className="flex items-center gap-2">
							<Clock className={`w-4 h-4 ${isNearExpiry ? 'text-orange-600' : 'text-blue-600'}`} />
							<span className={`text-sm ${isNearExpiry ? 'text-orange-800' : 'text-blue-800'}`}>
								{isNearExpiry ? 'Expires soon:' : 'Time remaining:'} {formatTime(timeLeft)}
							</span>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Payment Method Selection */}
			<Card>
				<CardContent className="p-4">
					<h3 className="font-medium text-gray-900 mb-3">Select Payment Method</h3>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{paymentMethods.map((method) => (
							<Button
								key={method.type}
								variant={selectedPaymentMethod === method.type ? 'primary' : 'outline'}
								onClick={() => setSelectedPaymentMethod(method.type)}
								className="justify-start h-auto p-3"
							>
								<div className="flex items-center gap-2">
									{method.type === 'lightning' && <Zap className="w-4 h-4" />}
									{method.type === 'bitcoin' && <div className="w-4 h-4 rounded-full bg-orange-500" />}
									<span className="text-sm">{method.label}</span>
								</div>
							</Button>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Invoice Details */}
			<Card>
				<CardContent className="p-4">
					<h3 className="font-medium text-gray-900 mb-3">Payment Details</h3>
					<div className="space-y-3">
						<div className="flex justify-between text-sm">
							<span className="text-gray-600">Recipient:</span>
							<span className="font-medium">{invoice.sellerName}</span>
						</div>
						<div className="flex justify-between text-sm">
							<span className="text-gray-600">Items:</span>
							<span className="font-medium">
								{invoice.items.length} item{invoice.items.length !== 1 ? 's' : ''}
							</span>
						</div>
						<div className="flex justify-between text-sm">
							<span className="text-gray-600">Method:</span>
							<span className="font-medium">{currentPaymentMethod.label}</span>
						</div>
						<Separator />
						<div className="flex justify-between font-semibold">
							<span>Total Amount:</span>
							<span className="flex items-center gap-1">
								<Zap className="w-4 h-4 text-yellow-500" />
								{formatSats(invoice.amount)} sats
							</span>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Payment Interface */}
			{invoice.status === 'pending' && !isExpired && (
				<Card>
					<CardContent className="p-4">
						<div className="text-center space-y-4">
							{/* QR Code */}
							<div className="flex justify-center">
								<QRCode
									value={currentPaymentMethod.details}
									size={240}
									title={`${currentPaymentMethod.label} Payment`}
									description={`Scan with your ${currentPaymentMethod.label.toLowerCase()} wallet`}
									showBorder={false}
									level="M"
								/>
							</div>

							<div className="space-y-3">
								<p className="text-sm text-gray-600">
									Scan with your wallet or copy the {currentPaymentMethod.label.toLowerCase()} details
								</p>

								{/* Payment String */}
								<div className="bg-gray-50 p-3 rounded-lg">
									<div className="flex items-center gap-2">
										<code className="text-xs font-mono flex-1 break-all text-gray-700">{currentPaymentMethod.details}</code>
										<Button
											variant="outline"
											size="sm"
											onClick={() => handleCopyToClipboard(currentPaymentMethod.details)}
											className="flex-shrink-0"
										>
											{copySuccess ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
										</Button>
									</div>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Order Items */}
			<Card>
				<CardContent className="p-4">
					<h4 className="font-medium text-gray-900 mb-3">Order Items</h4>
					<div className="space-y-2">
						{invoice.items.map((item, index) => (
							<div key={item.productId} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
								<div>
									<p className="font-medium text-sm">{item.name}</p>
									<p className="text-xs text-gray-500">Qty: {item.amount}</p>
								</div>
								<span className="text-sm font-medium">{formatSats(item.price)} sats</span>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Action Buttons */}
			<div className="space-y-3">
				{invoice.status === 'pending' && !isExpired && (
					<>
						<Button onClick={openInWallet} className="w-full bg-yellow-500 hover:bg-yellow-600 text-white">
							<ExternalLink className="w-4 h-4 mr-2" />
							Open in {currentPaymentMethod.label} Wallet
						</Button>

						<Button onClick={() => onPayInvoice(invoice.id)} variant="outline" className="w-full">
							I've Paid - Check Status
						</Button>
					</>
				)}

				{isExpired && (
					<Button onClick={handlePaymentRetry} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
						<RefreshCw className="w-4 h-4 mr-2" />
						Generate New Invoice
					</Button>
				)}

				{invoice.status === 'processing' && (
					<Button disabled className="w-full">
						<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
						Verifying Payment...
					</Button>
				)}

				{invoice.status === 'paid' && (
					<Button disabled className="w-full bg-green-600 text-white">
						<Check className="w-4 h-4 mr-2" />
						Payment Complete
					</Button>
				)}

				{invoice.status === 'failed' && (
					<Button
						onClick={handlePaymentRetry}
						variant="outline"
						className="w-full border-red-300 text-red-600 hover:bg-red-50"
						disabled={isRetrying}
					>
						{isRetrying ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
						{isRetrying ? 'Retrying...' : 'Retry Payment'}
					</Button>
				)}
			</div>
		</div>
	)
}
