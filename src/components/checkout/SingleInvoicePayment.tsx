import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QRCode } from '@/components/ui/qr-code'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, Copy, Zap, ExternalLink, RefreshCw, AlertTriangle, Timer, Wallet, CreditCard } from 'lucide-react'
import { useState, useEffect } from 'react'
import { copyToClipboard } from '@/lib/utils'
import { toast } from 'sonner'
import { LightningService } from '@/lib/utils/lightning'

// WebLN types
declare global {
	interface Window {
		webln?: {
			enable(): Promise<void>
			sendPayment(paymentRequest: string): Promise<{ preimage: string }>
		}
	}
}

export interface SingleInvoiceData {
	id: string
	bolt11: string
	amount: number
	description?: string
	recipientName?: string
	status?: 'pending' | 'paid' | 'failed' | 'expired'
	expiresAt?: number
	createdAt?: number
	verificationUrl?: string
}

interface SingleInvoicePaymentProps {
	invoice: SingleInvoiceData
	onPaymentComplete?: (invoiceId: string, preimage?: string) => void
	onPaymentFailed?: (invoiceId: string, error: string) => void
	showHeader?: boolean
	compact?: boolean
	nwcEnabled?: boolean
}

export function SingleInvoicePayment({
	invoice,
	onPaymentComplete,
	onPaymentFailed,
	showHeader = true,
	compact = false,
	nwcEnabled = true,
}: SingleInvoicePaymentProps) {
	const [copying, setCopying] = useState(false)
	const [timeLeft, setTimeLeft] = useState<number>(0)
	const [paymentStatus, setPaymentStatus] = useState(invoice.status || 'pending')
	const [polling, setPolling] = useState(false)
	const [nwcProcessing, setNwcProcessing] = useState(false)

	// Parse invoice details
	const invoiceDetails = LightningService.parseBolt11Invoice(invoice.bolt11)

	// Update payment status when invoice prop changes
	useEffect(() => {
		setPaymentStatus(invoice.status || 'pending')
	}, [invoice.status])

	// Calculate time remaining
	useEffect(() => {
		if (!invoice.expiresAt) return

		const updateTimeLeft = () => {
			const now = Date.now() / 1000
			const remaining = Math.max(0, invoice.expiresAt! - now)
			setTimeLeft(remaining)

			if (remaining === 0 && paymentStatus === 'pending') {
				setPaymentStatus('expired')
			}
		}

		updateTimeLeft()
		const interval = setInterval(updateTimeLeft, 1000)
		return () => clearInterval(interval)
	}, [invoice.expiresAt, paymentStatus])

	// Auto-start payment polling for pending invoices
	useEffect(() => {
		if (paymentStatus === 'pending' && invoice.verificationUrl && !polling) {
			handleStartPolling()
		}
	}, [paymentStatus, invoice.verificationUrl, polling])

	const formatTime = (seconds: number): string => {
		if (seconds <= 0) return 'Expired'
		const hours = Math.floor(seconds / 3600)
		const minutes = Math.floor((seconds % 3600) / 60)
		const secs = Math.floor(seconds % 60)

		if (hours > 0) {
			return `${hours}h ${minutes}m ${secs}s`
		} else if (minutes > 0) {
			return `${minutes}m ${secs}s`
		} else {
			return `${secs}s`
		}
	}

	const handleCopyInvoice = async () => {
		setCopying(true)
		try {
			await copyToClipboard(invoice.bolt11)
			toast.success('Invoice copied to clipboard!')
		} catch (error) {
			toast.error('Failed to copy invoice')
		} finally {
			setCopying(false)
		}
	}

	const handleStartPolling = async () => {
		if (!invoice.verificationUrl) return

		setPolling(true)

		// Use the existing startPaymentPolling method from LightningService
		const stopPolling = LightningService.startPaymentPolling(
			invoice.verificationUrl,
			(result) => {
				setPaymentStatus('paid')
				onPaymentComplete?.(invoice.id, result.preimage)
				toast.success('Payment confirmed!')
				setPolling(false)
			},
			(error) => {
				setPaymentStatus('failed')
				onPaymentFailed?.(invoice.id, error)
				toast.error('Payment verification failed')
				setPolling(false)
			},
			5000, // 5 second intervals
		)

		// Stop polling after 10 minutes
		setTimeout(
			() => {
				stopPolling()
				if (polling) {
					setPolling(false)
					setPaymentStatus('failed')
					onPaymentFailed?.(invoice.id, 'Payment verification timeout')
					toast.error('Payment verification timeout')
				}
			},
			10 * 60 * 1000,
		)
	}

	const handleNWCPayment = async () => {
		if (!window.webln) {
			toast.error('No WebLN wallet found. Please install a WebLN-compatible wallet.')
			return
		}

		setNwcProcessing(true)
		try {
			await window.webln.enable()
			const response = await window.webln.sendPayment(invoice.bolt11)

			if (response.preimage) {
				setPaymentStatus('paid')
				onPaymentComplete?.(invoice.id, response.preimage)
				toast.success('Payment sent successfully!')
			} else {
				throw new Error('No preimage received')
			}
		} catch (error) {
			console.error('NWC payment error:', error)
			const errorMessage = error instanceof Error ? error.message : 'Payment failed'
			onPaymentFailed?.(invoice.id, errorMessage)
			toast.error(`Payment failed: ${errorMessage}`)
		} finally {
			setNwcProcessing(false)
		}
	}

	const getStatusColor = (status: string) => {
		switch (status) {
			case 'paid':
				return 'bg-green-100 text-green-800'
			case 'failed':
				return 'bg-red-100 text-red-800'
			case 'expired':
				return 'bg-gray-100 text-gray-800'
			default:
				return 'bg-yellow-100 text-yellow-800'
		}
	}

	const getStatusIcon = (status: string) => {
		switch (status) {
			case 'paid':
				return <Check className="w-4 h-4" />
			case 'failed':
				return <AlertTriangle className="w-4 h-4" />
			case 'expired':
				return <Timer className="w-4 h-4" />
			default:
				return <Timer className="w-4 h-4" />
		}
	}

	const isExpired = timeLeft <= 0 && invoice.expiresAt
	const isPaid = paymentStatus === 'paid'
	const isFailed = paymentStatus === 'failed'
	const canPay = !isPaid && !isFailed && !isExpired

	if (compact) {
		return (
			<Card className="w-full">
				<CardContent className="p-4">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<Badge className={getStatusColor(paymentStatus)} variant="outline">
								{getStatusIcon(paymentStatus)}
								<span className="ml-1 capitalize">{paymentStatus}</span>
							</Badge>
							<span className="font-mono text-sm">{invoice.amount} sats</span>
						</div>
						{invoice.recipientName && <span className="text-sm text-gray-600 truncate">{invoice.recipientName}</span>}
					</div>

					{canPay && (
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={handleCopyInvoice} disabled={copying} className="flex-1">
								<Copy className="w-4 h-4 mr-1" />
								{copying ? 'Copying...' : 'Copy Invoice'}
							</Button>
							{nwcEnabled && window.webln && (
								<Button size="sm" onClick={handleNWCPayment} disabled={nwcProcessing} className="flex-1">
									<Zap className="w-4 h-4 mr-1" />
									{nwcProcessing ? 'Paying...' : 'Pay with NWC'}
								</Button>
							)}
						</div>
					)}

					{timeLeft > 0 && <div className="text-xs text-gray-500 mt-2 text-center">Expires in: {formatTime(timeLeft)}</div>}
				</CardContent>
			</Card>
		)
	}

	return (
		<Card className="w-full">
			{showHeader && (
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-lg">Lightning Invoice</CardTitle>
						<Badge className={getStatusColor(paymentStatus)} variant="outline">
							{getStatusIcon(paymentStatus)}
							<span className="ml-1 capitalize">{paymentStatus}</span>
						</Badge>
					</div>
					{invoice.recipientName && <p className="text-sm text-gray-600">For: {invoice.recipientName}</p>}
				</CardHeader>
			)}

			<CardContent className="space-y-4">
				<div className="text-center">
					<div className="text-2xl font-bold">{invoice.amount} sats</div>
					{invoice.description && <div className="text-sm text-gray-600 mt-1">{invoice.description}</div>}
					{timeLeft > 0 && <div className="text-sm text-gray-500 mt-1">Expires in: {formatTime(timeLeft)}</div>}
				</div>

				{canPay && (
					<Tabs defaultValue="qr" className="w-full">
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="qr" className="flex items-center gap-2">
								<CreditCard className="w-4 h-4" />
								QR Code
							</TabsTrigger>
							{nwcEnabled && window.webln && (
								<TabsTrigger value="nwc" className="flex items-center gap-2">
									<Wallet className="w-4 h-4" />
									NWC
								</TabsTrigger>
							)}
						</TabsList>

						<TabsContent value="qr" className="space-y-4">
							<div className="flex justify-center">
								<QRCode value={`lightning:${invoice.bolt11}`} size={200} level="M" className="border rounded-lg" />
							</div>

							<div className="space-y-2">
								<Button variant="outline" onClick={handleCopyInvoice} disabled={copying} className="w-full">
									<Copy className="w-4 h-4 mr-2" />
									{copying ? 'Copying...' : 'Copy Invoice'}
								</Button>

								<Button variant="ghost" size="sm" onClick={() => window.open(`lightning:${invoice.bolt11}`, '_blank')} className="w-full">
									<ExternalLink className="w-4 h-4 mr-2" />
									Open in Wallet
								</Button>
							</div>
						</TabsContent>

						{nwcEnabled && window.webln && (
							<TabsContent value="nwc" className="space-y-4">
								<div className="text-center text-sm text-gray-600 mb-4">Pay instantly using your connected Lightning wallet</div>

								<Button onClick={handleNWCPayment} disabled={nwcProcessing} className="w-full" size="lg">
									<Zap className="w-4 h-4 mr-2" />
									{nwcProcessing ? (
										<>
											<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
											Processing Payment...
										</>
									) : (
										'Pay with NWC'
									)}
								</Button>

								{polling && (
									<div className="text-center text-sm text-gray-600">
										<RefreshCw className="w-4 h-4 mr-1 inline animate-spin" />
										Verifying payment...
									</div>
								)}
							</TabsContent>
						)}
					</Tabs>
				)}

				{isPaid && (
					<div className="text-center p-4 bg-green-50 rounded-lg">
						<Check className="w-8 h-8 text-green-600 mx-auto mb-2" />
						<div className="text-green-800 font-semibold">Payment Confirmed!</div>
					</div>
				)}

				{(isFailed || isExpired) && (
					<div className="text-center p-4 bg-red-50 rounded-lg">
						<AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
						<div className="text-red-800 font-semibold">{isExpired ? 'Invoice Expired' : 'Payment Failed'}</div>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
