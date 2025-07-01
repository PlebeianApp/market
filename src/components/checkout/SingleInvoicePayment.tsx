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
import { useInvoiceGeneration } from '@/hooks/useInvoiceGeneration'

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
	lightningAddress?: string // Lightning address for generating new invoices
	recipientPubkey?: string // Pubkey of the payment recipient
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
	const [generatedBolt11, setGeneratedBolt11] = useState<string>('')
	const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false)
	const { generateInvoiceForSeller } = useInvoiceGeneration({ fallbackToMock: true })

	// Determine what payment data we have
	const hasBolt11 = invoice.bolt11 && invoice.bolt11.length > 0
	const hasLightningAddress = invoice.lightningAddress && invoice.lightningAddress.length > 0
	const currentBolt11 = generatedBolt11 || invoice.bolt11

	// Parse invoice details only if we have a BOLT11 invoice
	const invoiceDetails = currentBolt11 ? LightningService.parseBolt11Invoice(currentBolt11) : null

	// Generate BOLT11 invoice from lightning address if needed
	const generateBolt11FromAddress = async () => {
		if (!hasLightningAddress || !invoice.lightningAddress || !invoice.recipientPubkey) {
			toast.error('No lightning address available for invoice generation')
			return
		}

		setIsGeneratingInvoice(true)

		try {
			const invoiceData = await generateInvoiceForSeller(
				invoice.recipientPubkey,
				invoice.amount,
				invoice.description || 'Payment',
				invoice.id,
				[], // Empty items array for order payments
				invoice.description?.includes('V4V') ? 'v4v' : 'seller',
			)

			setGeneratedBolt11(invoiceData.bolt11)
			toast.success('Fresh invoice generated!')
		} catch (error) {
			console.error('Failed to generate invoice from lightning address:', error)
			toast.error(`Failed to generate invoice: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsGeneratingInvoice(false)
		}
	}

	// Auto-generate invoice if we only have lightning address
	useEffect(() => {
		if (!hasBolt11 && hasLightningAddress && !generatedBolt11 && !isGeneratingInvoice) {
			generateBolt11FromAddress()
		}
	}, [hasBolt11, hasLightningAddress, generatedBolt11, isGeneratingInvoice])

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
		if (!currentBolt11) {
			toast.error('No invoice available to copy')
			return
		}

		setCopying(true)
		try {
			await copyToClipboard(currentBolt11)
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
		if (!currentBolt11) {
			toast.error('No invoice available for payment')
			return
		}

		if (!window.webln) {
			toast.error('No WebLN wallet found. Please install a WebLN-compatible wallet.')
			return
		}

		setNwcProcessing(true)
		try {
			await window.webln.enable()
			const response = await window.webln.sendPayment(currentBolt11)

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

					{/* Show loading state when generating invoice */}
					{isGeneratingInvoice && (
						<div className="flex items-center justify-center py-4">
							<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
							<span className="text-sm text-gray-600">Generating invoice...</span>
						</div>
					)}

					{/* Show actions when we have an invoice and can pay */}
					{currentBolt11 && canPay && !isGeneratingInvoice && (
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

					{/* Show refresh button if invoice generation failed */}
					{!currentBolt11 && hasLightningAddress && !isGeneratingInvoice && (
						<Button variant="outline" size="sm" onClick={generateBolt11FromAddress} className="w-full">
							<RefreshCw className="w-4 h-4 mr-2" />
							Generate Invoice
						</Button>
					)}

					{timeLeft > 0 && <div className="text-xs text-gray-500 mt-2 text-center">Expires in: {formatTime(timeLeft)}</div>}
				</CardContent>
			</Card>
		)
	}

	return (
		<Card className="w-full max-w-md mx-auto">
			{showHeader && (
				<CardHeader className="text-center">
					<CardTitle className="flex items-center justify-center gap-2">
						<Zap className="w-5 h-5" />
						Lightning Invoice
					</CardTitle>
					{invoice.recipientName && <p className="text-sm text-gray-600">Pay to: {invoice.recipientName}</p>}
				</CardHeader>
			)}

			<CardContent className="space-y-4">
				{/* Status and Amount */}
				<div className="text-center space-y-2">
					<Badge className={getStatusColor(paymentStatus)} variant="outline">
						{getStatusIcon(paymentStatus)}
						<span className="ml-1 capitalize">{paymentStatus}</span>
					</Badge>
					<div className="text-2xl font-bold font-mono">{invoice.amount} sats</div>
					{invoice.description && <p className="text-sm text-gray-600">{invoice.description}</p>}
				</div>

				{/* Loading state when generating invoice */}
				{isGeneratingInvoice && (
					<div className="flex flex-col items-center justify-center py-8 space-y-4">
						<RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
						<p className="text-sm text-gray-600">Generating fresh invoice...</p>
					</div>
				)}

				{/* QR Code and Invoice - only show when we have a BOLT11 invoice */}
				{currentBolt11 && !isGeneratingInvoice && (
					<Tabs defaultValue="qr" className="w-full">
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="qr">QR Code</TabsTrigger>
							<TabsTrigger value="invoice">Invoice</TabsTrigger>
						</TabsList>

						<TabsContent value="qr" className="space-y-4">
							<div className="flex justify-center">
								<QRCode value={currentBolt11} size={200} />
							</div>
							<p className="text-xs text-center text-gray-500">Scan with Lightning wallet</p>
						</TabsContent>

						<TabsContent value="invoice" className="space-y-4">
							<div className="bg-gray-50 p-3 rounded text-xs font-mono break-all border">{currentBolt11}</div>
							<Button variant="outline" onClick={handleCopyInvoice} disabled={copying} className="w-full">
								<Copy className="w-4 h-4 mr-2" />
								{copying ? 'Copying...' : 'Copy Invoice'}
							</Button>
						</TabsContent>
					</Tabs>
				)}

				{/* Show generate button if no invoice available */}
				{!currentBolt11 && hasLightningAddress && !isGeneratingInvoice && (
					<div className="text-center space-y-4">
						<p className="text-sm text-gray-600">No invoice available. Generate a fresh one?</p>
						<Button onClick={generateBolt11FromAddress} className="w-full">
							<RefreshCw className="w-4 h-4 mr-2" />
							Generate Invoice from {invoice.lightningAddress}
						</Button>
					</div>
				)}

				{/* Payment Actions */}
				{currentBolt11 && canPay && !isGeneratingInvoice && (
					<div className="space-y-3">
						{/* WebLN Payment */}
						{nwcEnabled && window.webln && (
							<Button onClick={handleNWCPayment} disabled={nwcProcessing} className="w-full" size="lg">
								<Wallet className="w-4 h-4 mr-2" />
								{nwcProcessing ? 'Processing Payment...' : 'Pay with Wallet'}
							</Button>
						)}

						{/* Copy Invoice Button */}
						<Button variant="outline" onClick={handleCopyInvoice} disabled={copying} className="w-full">
							<Copy className="w-4 h-4 mr-2" />
							{copying ? 'Copying...' : 'Copy Invoice'}
						</Button>

						{/* Refresh Invoice Button */}
						{hasLightningAddress && (
							<Button variant="outline" onClick={generateBolt11FromAddress} disabled={isGeneratingInvoice} className="w-full">
								<RefreshCw className="w-4 h-4 mr-2" />
								Generate Fresh Invoice
							</Button>
						)}
					</div>
				)}

				{/* Timer */}
				{timeLeft > 0 && (
					<div className="text-center">
						<p className="text-sm text-gray-600">
							<Timer className="w-4 h-4 inline mr-1" />
							Expires in: {formatTime(timeLeft)}
						</p>
					</div>
				)}

				{/* Payment Status Messages */}
				{isPaid && <div className="text-center text-green-600 font-medium">✅ Payment Completed</div>}
				{isFailed && <div className="text-center text-red-600 font-medium">❌ Payment Failed</div>}
				{isExpired && <div className="text-center text-gray-600 font-medium">⏰ Invoice Expired</div>}
			</CardContent>
		</Card>
	)
}
