import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { QRCode } from '@/components/ui/qr-code'
import { copyToClipboard } from '@/lib/utils'
import { Check, ChevronLeft, ChevronRight, Clock, Copy, CreditCard, Users, Wallet, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface PaymentInvoice {
	id: string
	sellerPubkey: string
	sellerName: string
	amount: number
	bolt11: string
	expiresAt?: number
	status: 'pending' | 'processing' | 'paid' | 'expired' | 'failed'
	type: 'merchant' | 'v4v'
}

interface PaymentInterfaceProps {
	invoices: PaymentInvoice[]
	currentIndex: number
	onPaymentComplete: (invoiceId: string, method: 'lightning' | 'nwc') => void
	onNavigate: (index: number) => void
	onPayAll?: () => void
	nwcEnabled?: boolean
}

export function PaymentInterface({
	invoices,
	currentIndex,
	onPaymentComplete,
	onNavigate,
	onPayAll,
	nwcEnabled = false,
}: PaymentInterfaceProps) {
	const [copySuccess, setCopySuccess] = useState(false)
	const [timeLeft, setTimeLeft] = useState<number | null>(null)
	const [processingNWC, setProcessingNWC] = useState(false)

	const invoice = invoices[currentIndex]
	const paidCount = invoices.filter((inv) => inv.status === 'paid').length
	const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0)
	const remainingAmount = invoices.filter((inv) => inv.status !== 'paid').reduce((sum, inv) => sum + inv.amount, 0)

	// Timer for invoice expiration
	useEffect(() => {
		if (!invoice?.expiresAt) return

		const updateTimer = () => {
			const now = Date.now()
			const remaining = Math.max(0, Math.floor((invoice.expiresAt! - now) / 1000))
			setTimeLeft(remaining)
		}

		updateTimer()
		const interval = setInterval(updateTimer, 1000)
		return () => clearInterval(interval)
	}, [invoice?.expiresAt])

	const formatSats = (sats: number) => Math.round(sats).toLocaleString()
	const formatTime = (seconds: number) => {
		const minutes = Math.floor(seconds / 60)
		const secs = seconds % 60
		return `${minutes}:${secs.toString().padStart(2, '0')}`
	}

	const handleCopyInvoice = async () => {
		if (!invoice.bolt11) return
		await copyToClipboard(invoice.bolt11)
		setCopySuccess(true)
		toast.success('Invoice copied to clipboard')
		setTimeout(() => setCopySuccess(false), 2000)
	}

	const handleLightningPayment = () => {
		if (!invoice.bolt11) return
		const url = `lightning:${invoice.bolt11}`
		const link = document.createElement('a')
		link.href = url
		link.click()
		onPaymentComplete(invoice.id, 'lightning')
	}

	const handleNWCPayment = async () => {
		setProcessingNWC(true)
		try {
			// Simulate NWC payment
			await new Promise((resolve) => setTimeout(resolve, 2000))
			onPaymentComplete(invoice.id, 'nwc')
			toast.success('NWC payment successful')
		} catch (error) {
			toast.error('NWC payment failed')
		} finally {
			setProcessingNWC(false)
		}
	}

	const handlePayAllNWC = async () => {
		if (!onPayAll) return
		setProcessingNWC(true)
		try {
			onPayAll()
			toast.success('Paying all invoices with NWC...')
		} catch (error) {
			toast.error('Failed to pay all invoices')
		} finally {
			setProcessingNWC(false)
		}
	}

	if (!invoice) return null

	const isExpired = timeLeft === 0
	const isNearExpiry = timeLeft && timeLeft < 300

	return (
		<div className="space-y-4">
			{/* Progress Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h3 className="text-lg font-semibold">
						Payment {currentIndex + 1} of {invoices.length}
					</h3>
					<Badge variant={invoice.type === 'v4v' ? 'secondary' : 'outline'}>{invoice.type === 'v4v' ? 'V4V' : 'Merchant'}</Badge>
				</div>
				<div className="text-sm text-gray-600">
					{paidCount}/{invoices.length} paid
				</div>
			</div>

			<Progress value={(paidCount / invoices.length) * 100} className="h-2" />

			{/* Navigation */}
			{invoices.length > 1 && (
				<div className="flex items-center justify-between">
					<Button variant="outline" size="sm" onClick={() => onNavigate(currentIndex - 1)} disabled={currentIndex === 0}>
						<ChevronLeft className="w-4 h-4 mr-1" />
						Previous
					</Button>

					<div className="flex gap-1">
						{invoices.map((_, index) => (
							<button
								key={index}
								onClick={() => onNavigate(index)}
								className={`w-2 h-2 rounded-full transition-colors ${
									index === currentIndex ? 'bg-pink-500' : invoices[index].status === 'paid' ? 'bg-green-400' : 'bg-gray-300'
								}`}
							/>
						))}
					</div>

					<Button variant="outline" size="sm" onClick={() => onNavigate(currentIndex + 1)} disabled={currentIndex === invoices.length - 1}>
						Next
						<ChevronRight className="w-4 h-4 ml-1" />
					</Button>
				</div>
			)}

			{/* Payment Card */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							{invoice.type === 'v4v' ? <Users className="w-5 h-5 text-purple-600" /> : <CreditCard className="w-5 h-5 text-blue-600" />}
							<span>{invoice.sellerName}</span>
							{invoice.status === 'paid' && <Check className="w-4 h-4 text-green-600" />}
						</div>
						<div className="text-right">
							<div className="text-lg font-bold">{formatSats(invoice.amount)} sats</div>
							{timeLeft && timeLeft > 0 && (
								<div className={`text-sm ${isNearExpiry ? 'text-orange-600' : 'text-gray-500'}`}>
									<Clock className="w-3 h-3 inline mr-1" />
									{formatTime(timeLeft)}
								</div>
							)}
						</div>
					</CardTitle>
				</CardHeader>

				<CardContent className="space-y-4">
					{/* Payment Status */}
					{invoice.status === 'paid' ? (
						<div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded">
							<Check className="w-5 h-5" />
							<span>Payment completed</span>
						</div>
					) : (
						<>
							{/* QR Code */}
							<div className="flex justify-center">
								<QRCode value={invoice.bolt11} size={200} />
							</div>

							{/* Payment Actions */}
							<div className="grid grid-cols-1 gap-2">
								<Button onClick={handleLightningPayment} className="w-full" disabled={isExpired}>
									<Zap className="w-4 h-4 mr-2" />
									Pay with Lightning
								</Button>

								{nwcEnabled && (
									<Button variant="outline" onClick={handleNWCPayment} disabled={isExpired || processingNWC} className="w-full">
										<Wallet className="w-4 h-4 mr-2" />
										{processingNWC ? 'Processing...' : 'Pay with NWC'}
									</Button>
								)}

								<Button variant="ghost" size="sm" onClick={handleCopyInvoice} className="w-full">
									<Copy className="w-4 h-4 mr-2" />
									{copySuccess ? 'Copied!' : 'Copy Invoice'}
								</Button>
							</div>
						</>
					)}
				</CardContent>
			</Card>

			{/* Batch Payment Option */}
			{nwcEnabled && onPayAll && remainingAmount > 0 && (
				<Card className="border-purple-200 bg-purple-50">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div>
								<h4 className="font-medium">Pay All Remaining</h4>
								<p className="text-sm text-gray-600">
									{invoices.length - paidCount} invoices • {formatSats(remainingAmount)} sats total
								</p>
							</div>
							<Button onClick={handlePayAllNWC} disabled={processingNWC} className="bg-purple-600 hover:bg-purple-700">
								<Wallet className="w-4 h-4 mr-2" />
								{processingNWC ? 'Processing...' : 'Pay All'}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
