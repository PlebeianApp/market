import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Check, Copy, CreditCard, Zap } from 'lucide-react'
import { useState } from 'react'

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
}

interface InvoicePaymentComponentProps {
	invoice: LightningInvoiceData
	onPayInvoice: (invoiceId: string) => void
	invoiceNumber: number
	totalInvoices: number
}

export function InvoicePaymentComponent({
	invoice,
	onPayInvoice,
	invoiceNumber,
	totalInvoices,
}: InvoicePaymentComponentProps) {
	const [copySuccess, setCopySuccess] = useState(false)

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(invoice.bolt11)
			setCopySuccess(true)
			setTimeout(() => setCopySuccess(false), 2000)
		} catch (err) {
			console.error('Failed to copy invoice:', err)
		}
	}

	const openInWallet = () => {
		// Try to open in Lightning wallet
		window.open(`lightning:${invoice.bolt11}`, '_blank')
	}

	const isExpired = invoice.expiresAt && Date.now() > invoice.expiresAt * 1000

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3 mb-6">
				<div className="p-2 bg-green-100 rounded-lg">
					<CreditCard className="h-5 w-5 text-green-600" />
				</div>
				<div>
					<h2 className="text-xl font-semibold">
						Payment {invoiceNumber} of {totalInvoices}
					</h2>
					<p className="text-gray-600">Pay {invoice.sellerName} with Lightning</p>
				</div>
			</div>

			{/* Invoice Details */}
			<div className="bg-gray-50 rounded-lg p-4">
				<h3 className="font-medium text-gray-900 mb-3">Invoice Details</h3>
				<div className="space-y-2">
					<div className="flex justify-between text-sm">
						<span className="text-gray-600">Seller:</span>
						<span className="font-medium">{invoice.sellerName}</span>
					</div>
					<div className="flex justify-between text-sm">
						<span className="text-gray-600">Items:</span>
						<span className="font-medium">
							{invoice.items.length} item{invoice.items.length !== 1 ? 's' : ''}
						</span>
					</div>
					{invoice.expiresAt && (
						<div className="flex justify-between text-sm">
							<span className="text-gray-600">Expires:</span>
							<span className={`font-medium ${isExpired ? 'text-red-600' : 'text-gray-900'}`}>
								{new Date(invoice.expiresAt * 1000).toLocaleString()}
							</span>
						</div>
					)}
					<div className="border-t pt-2 mt-3">
						<div className="flex justify-between font-semibold">
							<span>Total Amount:</span>
							<span className="flex items-center gap-1">
								<Zap className="w-4 h-4 text-yellow-500" />
								{formatSats(invoice.amount)} sats
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Lightning Invoice */}
			{invoice.status === 'pending' && !isExpired && (
				<Card>
					<CardContent className="p-4">
						<div className="text-center space-y-4">
							<div className="bg-white p-4 rounded-lg border-2 border-dashed border-gray-300">
								{/* QR Code placeholder - in a real app, you'd generate the QR code from bolt11 */}
								<div className="w-48 h-48 mx-auto bg-gray-100 rounded-lg flex items-center justify-center">
									<div className="text-xs text-gray-500 text-center">
										QR Code for<br/>Lightning Invoice<br/>
										<span className="font-mono text-xs">{invoice.bolt11.substring(0, 20)}...</span>
									</div>
								</div>
							</div>
							
							<div className="space-y-2">
								<p className="text-sm text-gray-600">Scan with your Lightning wallet or copy the invoice</p>
								
								{/* Invoice String */}
								<div className="bg-gray-50 p-3 rounded-lg">
									<div className="flex items-center gap-2">
										<code className="text-xs font-mono flex-1 break-all text-gray-700">
											{invoice.bolt11}
										</code>
										<Button
											variant="outline"
											size="sm"
											onClick={copyToClipboard}
											className="flex-shrink-0"
										>
											{copySuccess ? (
												<Check className="w-4 h-4 text-green-600" />
											) : (
												<Copy className="w-4 h-4" />
											)}
										</Button>
									</div>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Order Items */}
			<div className="space-y-3">
				<h4 className="font-medium text-gray-900">Order Items</h4>
				{invoice.items.map((item, index) => (
					<div key={item.productId} className="flex justify-between items-center py-2 border-b border-gray-100">
						<div>
							<p className="font-medium text-sm">{item.name}</p>
							<p className="text-xs text-gray-500">Qty: {item.amount}</p>
						</div>
						<span className="text-sm font-medium">{formatSats(item.price)} sats</span>
					</div>
				))}
			</div>

			{/* Action Buttons */}
			<div className="space-y-3">
				{invoice.status === 'pending' && !isExpired && (
					<>
						<Button 
							onClick={openInWallet} 
							className="w-full bg-yellow-500 hover:bg-yellow-600 text-white"
						>
							<Zap className="w-4 h-4 mr-2" />
							Open in Lightning Wallet
						</Button>
						
						<Button 
							onClick={() => onPayInvoice(invoice.id)} 
							variant="outline" 
							className="w-full"
						>
							I've Paid - Check Status
						</Button>
					</>
				)}

				{isExpired && (
					<Button disabled className="w-full bg-red-100 text-red-600">
						Invoice Expired
					</Button>
				)}

				{invoice.status === 'processing' && (
					<Button disabled className="w-full">
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
						onClick={() => onPayInvoice(invoice.id)} 
						variant="outline" 
						className="w-full border-red-300 text-red-600"
					>
						Payment Failed - Retry
					</Button>
				)}
			</div>
		</div>
	)
} 