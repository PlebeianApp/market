import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createOnChainPaymentRequest, type OnChainPaymentRequestData } from '@/publish/orders'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { useState } from 'react'
import { toast } from 'sonner'
import { ndkActions } from '@/lib/stores/ndk'
import { getOrderId, getOrderAmount, getBuyerPubkey } from '@/queries/orders'

interface ProvideBitcoinAddressDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	order: OrderWithRelatedEvents
	isV4V?: boolean
	v4vRecipientName?: string
	onComplete?: () => void
}

export function ProvideBitcoinAddressDialog({
	open,
	onOpenChange,
	order,
	isV4V = false,
	v4vRecipientName,
	onComplete,
}: ProvideBitcoinAddressDialogProps) {
	const [bitcoinAddress, setBitcoinAddress] = useState('')
	const [loading, setLoading] = useState(false)
	const ndk = ndkActions.getNDK()

	const validateBitcoinAddress = (address: string): boolean => {
		// Basic Bitcoin address validation (supports legacy, segwit, taproot)
		const legacyRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
		const segwitRegex = /^(bc1|tb1|bcrt1)[a-z0-9]{39,87}$/i

		return legacyRegex.test(address) || segwitRegex.test(address)
	}

	const handleSubmit = async () => {
		if (!bitcoinAddress.trim()) {
			toast.error('Please enter a Bitcoin address')
			return
		}

		if (!validateBitcoinAddress(bitcoinAddress.trim())) {
			toast.error('Invalid Bitcoin address format')
			return
		}

		setLoading(true)
		try {
			const signer = ndkActions.getSigner()
			const currentUser = ndk?.activeUser

			if (!signer || !currentUser) {
				toast.error('No signer available')
				return
			}

			const orderId = getOrderId(order.order)
			const buyerPubkey = getBuyerPubkey(order.order)
			const amountSats = parseInt(getOrderAmount(order.order) || '0')

			if (!orderId || !buyerPubkey) {
				toast.error('Invalid order data')
				return
			}

			const data: OnChainPaymentRequestData = {
				buyerPubkey: buyerPubkey,
				recipientPubkey: currentUser.pubkey,
				orderId: orderId,
				amountSats: amountSats,
				bitcoinAddress: bitcoinAddress.trim(),
				isV4V: isV4V,
				v4vRecipientName: v4vRecipientName,
			}

			const event = await createOnChainPaymentRequest(data)
			await event.publish()

			toast.success(isV4V ? 'V4V payment address provided successfully' : 'Bitcoin address provided successfully')

			if (onComplete) {
				onComplete()
			}

			onOpenChange(false)
			setBitcoinAddress('')
		} catch (error) {
			console.error('Error providing Bitcoin address:', error)
			toast.error('Failed to provide Bitcoin address')
		} finally {
			setLoading(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{isV4V ? 'Provide V4V Payment Address' : 'Provide Bitcoin Address'}</DialogTitle>
					<DialogDescription>
						{isV4V
							? `Provide a Bitcoin address to receive ${getOrderAmount(order.order)} sats for V4V contribution.`
							: `Provide a Bitcoin address to receive payment for this order (${getOrderAmount(order.order)} sats).`}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="bitcoin-address">Bitcoin Address</Label>
						<Input
							id="bitcoin-address"
							type="text"
							placeholder="bc1q..."
							value={bitcoinAddress}
							onChange={(e) => setBitcoinAddress(e.target.value)}
							disabled={loading}
							className="font-mono"
						/>
						<p className="text-xs text-muted-foreground">Enter a fresh Bitcoin address (legacy, segwit, or taproot supported)</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={loading || !bitcoinAddress.trim()}>
						{loading ? 'Submitting...' : 'Provide Address'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
