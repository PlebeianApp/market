import type { PrivateOrderDeliveryDetails } from '../messaging/privateOrderMessage'
import type { PaymentInvoiceData } from '../checkout'

export interface ParsedOrderAddress {
	name?: string
	street?: string
	street2?: string
	city?: string
	state?: string
	zip?: string
	country?: string
}

/** Best-effort split of a free-text address (newline or comma separated); null when it has no separators. */
export function parseOrderAddress(addressString: string): ParsedOrderAddress | null {
	let lines: string[]

	if (addressString.includes('\n')) {
		lines = addressString
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	} else if (addressString.includes(',')) {
		lines = addressString
			.split(',')
			.map((line) => line.trim())
			.filter(Boolean)
	} else {
		return null
	}

	if (lines.length === 0) return null

	const result: ParsedOrderAddress = {}
	const zipPattern = /^\d{4,6}(-\d{4})?$/
	const statePattern = /^[A-Z]{2}$/

	result.name = lines[0]
	if (lines.length >= 2) result.street = lines[1]

	if (lines.length >= 3) {
		let currentIndex = lines.length - 1
		const lastItem = lines[currentIndex]

		if (zipPattern.test(lastItem)) {
			result.zip = lastItem
			currentIndex--

			if (currentIndex >= 2) {
				result.city = lines[currentIndex]
				currentIndex--
			}
		} else {
			result.country = lastItem
			currentIndex--

			if (currentIndex >= 2) {
				const secondLast = lines[currentIndex]
				if (zipPattern.test(secondLast)) {
					result.zip = secondLast
					currentIndex--

					if (currentIndex >= 2) {
						const beforeZip = lines[currentIndex]
						if (statePattern.test(beforeZip) && currentIndex > 2) {
							result.state = beforeZip
							currentIndex--
							result.city = lines[currentIndex]
							currentIndex--
						} else {
							result.city = beforeZip
							currentIndex--
						}
					}
				} else {
					result.city = secondLast
					currentIndex--
				}
			}
		}

		if (currentIndex > 1) {
			const street2Lines = lines.slice(2, currentIndex + 1)
			if (street2Lines.length > 0) result.street2 = street2Lines.join(', ')
		}
	}

	return result
}

interface TaggedEvent {
	pubkey: string
	tags: string[][]
}

export function extractPaymentMethods(paymentRequest: TaggedEvent) {
	return paymentRequest.tags
		.filter((tag) => tag[0] === 'payment')
		.map((tag) => ({
			type: tag[1] as 'lightning' | 'bitcoin' | 'other',
			details: tag[2],
			proof: tag[3] || undefined,
		}))
}

/**
 * A request counts as paid when a receipt names the same recipient and an amount within 2 sats.
 * This reads relay-published receipts, so it reflects claimed payment, not verified settlement.
 */
export function isPaymentCompleted(paymentRequest: TaggedEvent, paymentReceipts: readonly TaggedEvent[]): boolean {
	const requestAmount = paymentRequest.tags.find((tag) => tag[0] === 'amount')?.[1] || '0'
	const requestRecipient = paymentRequest.tags.find((tag) => tag[0] === 'recipient')?.[1] || paymentRequest.pubkey

	return paymentReceipts.some((receipt) => {
		const orderTag = receipt.tags.find((tag) => tag[0] === 'order')
		const amountTag = receipt.tags.find((tag) => tag[0] === 'amount')
		const recipientTag = receipt.tags.find((tag) => tag[0] === 'p')
		const paymentTag = receipt.tags.find((tag) => tag[0] === 'payment')

		const amountDiff = Math.abs(parseInt(requestAmount, 10) - parseInt(amountTag?.[1] || '0', 10))
		return !!(orderTag && amountTag && recipientTag && paymentTag && recipientTag[1] === requestRecipient && amountDiff <= 2)
	})
}

export type OrderInvoiceSource = 'request' | 'both'

export type InvoiceWithSource = PaymentInvoiceData & {
	source: OrderInvoiceSource
	localCopies: PaymentInvoiceData[]
}

export interface PrivateOrderDetailRow {
	label: string
	value: string
}

function getAddressLines(address: PrivateOrderDeliveryDetails['delivery']['address']): string[] {
	if (!address) return []
	const cityLine = [address.city, address.zipPostcode].filter(Boolean).join(' ')
	return [address.firstLineOfAddress, address.additionalInformation, cityLine, address.country].filter((line): line is string =>
		Boolean(line?.trim()),
	)
}

export function getPrivateOrderDetailsRows(details: PrivateOrderDeliveryDetails): PrivateOrderDetailRow[] {
	const rows: PrivateOrderDetailRow[] = []
	const { delivery } = details

	if (delivery.email) rows.push({ label: 'Digital contact', value: delivery.email })
	if (delivery.name) rows.push({ label: 'Recipient', value: delivery.name })

	const addressLines = getAddressLines(delivery.address)
	if (addressLines.length > 0) rows.push({ label: 'Address', value: addressLines.join('\n') })

	if (delivery.phone) rows.push({ label: 'Phone', value: delivery.phone })
	if (details.orderNotes?.trim()) rows.push({ label: 'Order notes', value: details.orderNotes.trim() })

	return rows
}
