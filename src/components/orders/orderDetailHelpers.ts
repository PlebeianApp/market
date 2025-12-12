import type { PaymentInvoiceData } from '@/lib/types/invoice'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

/**
 * Helper functions for extracting data from order events
 */

export const getOrderId = (orderEvent: NDKEvent): string => {
	return orderEvent.tags.find((tag) => tag[0] === 'order')?.[1] || orderEvent.id
}

export const getTotalAmount = (orderEvent: NDKEvent): number => {
	return parseInt(orderEvent.tags.find((tag) => tag[0] === 'amount')?.[1] || '0')
}

export const getProductRefs = (orderEvent: NDKEvent): string[] => {
	return orderEvent.tags.filter((tag) => tag[0] === 'item').map((tag) => tag[1])
}

export const getOrderItems = (orderEvent: NDKEvent): Array<{ productRef: string; quantity: number }> => {
	return orderEvent.tags
		.filter((tag) => tag[0] === 'item')
		.map((tag) => ({
			productRef: tag[1],
			quantity: parseInt(tag[2] || '1', 10),
		}))
}

export const getSellerPubkey = (orderEvent: NDKEvent): string => {
	return orderEvent.tags.find((tag) => tag[0] === 'p')?.[1] || ''
}

export const getShippingRef = (orderEvent: NDKEvent): string | undefined => {
	return orderEvent.tags.find((tag) => tag[0] === 'shipping')?.[1]
}

export const makeInvoiceKey = (invoice: PaymentInvoiceData) => {
	return `${invoice.orderId}:${invoice.recipientPubkey}:${invoice.amount}:${invoice.type}`
}

/**
 * Parse address string into structured components
 */
export const parseAddress = (addressString: string) => {
	// Handle both newline-separated and comma-separated addresses
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

	const result: {
		name?: string
		street?: string
		street2?: string
		city?: string
		state?: string
		zip?: string
		country?: string
	} = {}

	const zipPattern = /^\d{4,6}(-\d{4})?$/
	const statePattern = /^[A-Z]{2}$/

	if (lines.length >= 1) {
		result.name = lines[0]
	}

	if (lines.length >= 2) {
		result.street = lines[1]
	}

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
			if (street2Lines.length > 0) {
				result.street2 = street2Lines.join(', ')
			}
		}
	}

	return result
}

/**
 * Extract payment methods from payment request events
 */
export const extractPaymentMethods = (paymentRequest: NDKEvent) => {
	const paymentTags = paymentRequest.tags.filter((tag) => tag[0] === 'payment')
	return paymentTags.map((tag) => ({
		type: tag[1] as 'lightning' | 'bitcoin' | 'other',
		details: tag[2],
		proof: tag[3] || undefined,
	}))
}

/**
 * Check if payment has been completed based on receipts
 */
export const isPaymentCompleted = (paymentRequest: NDKEvent, paymentReceipts: NDKEvent[]): boolean => {
	const requestAmount = paymentRequest.tags.find((tag) => tag[0] === 'amount')?.[1] || '0'
	const requestRecipient = paymentRequest.tags.find((tag) => tag[0] === 'recipient')?.[1] || paymentRequest.pubkey

	const matchingReceipt = paymentReceipts.find((receipt) => {
		const orderTag = receipt.tags.find((tag) => tag[0] === 'order')
		const amountTag = receipt.tags.find((tag) => tag[0] === 'amount')
		const recipientTag = receipt.tags.find((tag) => tag[0] === 'p')
		const paymentTag = receipt.tags.find((tag) => tag[0] === 'payment')

		const requestAmountNum = parseInt(requestAmount, 10)
		const receiptAmountNum = parseInt(amountTag?.[1] || '0', 10)
		const amountDiff = Math.abs(requestAmountNum - receiptAmountNum)
		const amountMatches = amountDiff <= 2

		const recipientMatches = recipientTag?.[1] === requestRecipient

		return orderTag && amountTag && recipientTag && paymentTag && recipientMatches && amountMatches
	})

	return !!matchingReceipt
}

/**
 * Get status icon styling
 */
export const getStatusColor = (status: string) => {
	switch (status) {
		case 'paid':
			return 'bg-green-100 text-green-800 border-green-300'
		case 'pending':
			return 'bg-yellow-100 text-yellow-800 border-yellow-300'
		case 'processing':
			return 'bg-blue-100 text-blue-800 border-blue-300'
		case 'expired':
			return 'bg-red-100 text-red-800 border-red-300'
		default:
			return 'bg-gray-100 text-gray-800 border-gray-300'
	}
}
