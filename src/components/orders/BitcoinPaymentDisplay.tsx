import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QRCode } from '@/components/ui/qr-code'
import { createPaymentReceiptEvent, type PaymentReceiptData } from '@/publish/orders'
import { useState } from 'react'
import { toast } from 'sonner'
import { ndkActions } from '@/lib/stores/ndk'
import { Copy, ExternalLink } from 'lucide-react'

interface BitcoinPaymentDisplayProps {
	address: string
	amount: number // in sats
	orderId: string
	invoiceId?: string
	recipientPubkey: string
	isV4V?: boolean
	onPaymentSubmitted?: () => void
}

export function BitcoinPaymentDisplay({
	address,
	amount,
	orderId,
	invoiceId,
	recipientPubkey,
	isV4V = false,
	onPaymentSubmitted,
}: BitcoinPaymentDisplayProps) {
	const [txid, setTxid] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const ndk = ndkActions.getNDK()

	// Create BIP21 URI
	const amountBTC = (amount / 100000000).toFixed(8)
	const paymentUri = `bitcoin:${address}?amount=${amountBTC}&label=${isV4V ? 'V4V Payment' : 'Order Payment'}`

	const handleCopy = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text)
			toast.success(`${label} copied to clipboard`)
		} catch (error) {
			console.error('Failed to copy:', error)
			toast.error('Failed to copy to clipboard')
		}
	}

	const validateTxid = (txid: string): boolean => {
		// Bitcoin TXID is 64 hexadecimal characters
		return /^[a-f0-9]{64}$/i.test(txid.trim())
	}

	const handleSubmitPayment = async () => {
		if (!txid.trim()) {
			toast.error('Please enter a transaction ID')
			return
		}

		if (!validateTxid(txid.trim())) {
			toast.error('Invalid transaction ID format (must be 64 hex characters)')
			return
		}

		setSubmitting(true)
		try {
			const currentUser = ndk?.activeUser
			const signer = ndkActions.getSigner()

			if (!signer || !currentUser) {
				toast.error('No signer available')
				return
			}

			const data: PaymentReceiptData = {
				merchantPubkey: recipientPubkey,
				buyerPubkey: currentUser.pubkey,
				orderId: orderId,
				amountSats: amount,
				paymentProof: {
					medium: 'bitcoin',
					reference: address,
					proof: txid.trim(),
				},
				notes: isV4V ? 'V4V contribution payment' : 'Order payment',
			}

			const event = await createPaymentReceiptEvent(data)
			await event.publish()

			toast.success(isV4V ? 'V4V payment submitted successfully' : 'Payment submitted successfully')

			if (onPaymentSubmitted) {
				onPaymentSubmitted()
			}

			setTxid('')
		} catch (error) {
			console.error('Error submitting payment:', error)
			toast.error('Failed to submit payment')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Card className="p-6 space-y-6">
			<div className="space-y-2">
				<h3 className="font-semibold text-lg">{isV4V ? 'V4V Payment' : 'Bitcoin Payment'}</h3>
				<p className="text-sm text-muted-foreground">
					Send <strong>{amount.toLocaleString()} sats</strong> ({amountBTC} BTC) to the address below
				</p>
			</div>

			{/* QR Code */}
			<div className="flex justify-center">
				<QRCode value={paymentUri} size={240} showBorder={false} title="Scan to Pay" />
			</div>

			{/* Bitcoin Address */}
			<div className="space-y-2">
				<Label htmlFor="bitcoin-address">Bitcoin Address</Label>
				<div className="flex gap-2">
					<Input id="bitcoin-address" value={address} readOnly className="font-mono text-sm" />
					<Button variant="outline" size="icon" onClick={() => handleCopy(address, 'Address')}>
						<Copy className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						onClick={() => window.open(`https://mempool.space/address/${address}`, '_blank')}
						title="View on Mempool"
					>
						<ExternalLink className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Amount */}
			<div className="space-y-2">
				<Label>Amount</Label>
				<div className="flex gap-2">
					<Input value={`${amount.toLocaleString()} sats (${amountBTC} BTC)`} readOnly className="font-mono" />
					<Button variant="outline" size="icon" onClick={() => handleCopy(amountBTC, 'Amount')}>
						<Copy className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* TXID Submission */}
			<div className="space-y-4 pt-4 border-t">
				<div className="space-y-2">
					<Label htmlFor="txid">Transaction ID (TXID)</Label>
					<div className="flex gap-2">
						<Input
							id="txid"
							type="text"
							placeholder="Enter transaction ID after sending payment..."
							value={txid}
							onChange={(e) => setTxid(e.target.value)}
							disabled={submitting}
							className="font-mono"
						/>
						{txid.trim() && validateTxid(txid) && (
							<Button
								variant="outline"
								size="icon"
								onClick={() => window.open(`https://mempool.space/tx/${txid.trim()}`, '_blank')}
								title="View transaction on Mempool"
							>
								<ExternalLink className="h-4 w-4" />
							</Button>
						)}
					</div>
					<p className="text-xs text-muted-foreground">After sending the payment, paste the transaction ID here to confirm</p>
				</div>

				<Button onClick={handleSubmitPayment} disabled={submitting || !txid.trim()} className="w-full">
					{submitting ? 'Submitting...' : 'Submit Payment Proof'}
				</Button>
			</div>

			{/* Help Text */}
			<div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
				<p>1. Send the exact amount to the Bitcoin address above</p>
				<p>2. Copy the transaction ID from your wallet</p>
				<p>3. Paste it in the field above and click Submit</p>
				<p>4. The seller will be notified and can verify the payment on the blockchain</p>
			</div>
		</Card>
	)
}
