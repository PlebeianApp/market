import { isValidDigitalDeliveryContact } from './deliveryRequirements'
import type { CheckoutInvoiceStatus } from './invoiceProgress'

export interface CheckoutFormData {
	name: string
	email: string
	phone: string
	firstLineOfAddress: string
	zipPostcode: string
	city: string
	country: string
	additionalInformation: string
}

export type CheckoutFormField = keyof CheckoutFormData

export const EMPTY_CHECKOUT_FORM: CheckoutFormData = {
	name: '',
	email: '',
	phone: '',
	firstLineOfAddress: '',
	zipPostcode: '',
	city: '',
	country: '',
	additionalInformation: '',
}

export interface CheckoutFieldRules {
	needsPhysicalAddress: boolean
	needsDigitalDeliveryContact: boolean
	isValidCountry: (country: string) => boolean
}

/** Field-level checkout validation; returns the first message or undefined when the value is acceptable. */
export function validateCheckoutField(field: CheckoutFormField, value: string, rules: CheckoutFieldRules): string | undefined {
	const trimmed = value.trim()
	const { needsPhysicalAddress } = rules

	switch (field) {
		case 'name':
			if (needsPhysicalAddress && !trimmed) return 'Name is required'
			if (trimmed && trimmed.length < 2) return 'Name must be at least 2 characters'
			return undefined
		case 'email':
			if (rules.needsDigitalDeliveryContact && !trimmed) return 'Digital delivery contact is required'
			if (trimmed && !isValidDigitalDeliveryContact(value)) return 'Please enter a valid email address'
			return undefined
		case 'firstLineOfAddress':
			if (!needsPhysicalAddress) return undefined
			if (!trimmed) return 'Address is required'
			return trimmed.length < 5 ? 'Please enter a complete address' : undefined
		case 'city':
			if (!needsPhysicalAddress) return undefined
			if (!trimmed) return 'City is required'
			return trimmed.length < 2 ? 'Please enter a valid city name' : undefined
		case 'zipPostcode':
			if (!needsPhysicalAddress) return undefined
			if (!trimmed) return 'ZIP/Postcode is required'
			return trimmed.length < 3 ? 'Please enter a valid ZIP/Postcode' : undefined
		case 'country':
			if (!needsPhysicalAddress) return undefined
			if (!trimmed) return 'Country is required'
			return rules.isValidCountry(value) ? undefined : 'Please select a valid country from the list'
		default:
			return undefined
	}
}

export type PaymentInvoiceStatus = CheckoutInvoiceStatus

export type PaymentInvoiceType = 'merchant' | 'v4v'

export interface PaymentInvoiceData {
	id: string
	orderId: string
	bolt11?: string | null
	amount: number
	description: string
	recipientName: string
	status: PaymentInvoiceStatus
	expiresAt?: number
	createdAt: number
	lightningAddress?: string | null
	recipientPubkey: string
	type: PaymentInvoiceType
	isZap?: boolean
	preimage?: string
	persistedAt?: number
	updatedAt?: number
}
