import { describe, expect, test } from 'bun:test'
import { validateCheckoutField, type CheckoutFieldRules } from './checkoutForm'
import { summarizeCheckoutDelivery, type CheckoutDeliveryRequirements } from './deliveryRequirements'

const physical: CheckoutFieldRules = {
	needsPhysicalAddress: true,
	needsDigitalDeliveryContact: false,
	isValidCountry: (c) => c === 'Germany',
}
const digital: CheckoutFieldRules = { needsPhysicalAddress: false, needsDigitalDeliveryContact: true, isValidCountry: () => false }

describe('validateCheckoutField', () => {
	test('physical delivery requires a complete address', () => {
		expect(validateCheckoutField('name', '', physical)).toBe('Name is required')
		expect(validateCheckoutField('firstLineOfAddress', '12', physical)).toBe('Please enter a complete address')
		expect(validateCheckoutField('zipPostcode', '1', physical)).toBe('Please enter a valid ZIP/Postcode')
		expect(validateCheckoutField('country', 'Atlantis', physical)).toBe('Please select a valid country from the list')
		expect(validateCheckoutField('country', 'Germany', physical)).toBeUndefined()
	})

	test('digital delivery skips the address and requires a contact', () => {
		expect(validateCheckoutField('firstLineOfAddress', '', digital)).toBeUndefined()
		expect(validateCheckoutField('name', '', digital)).toBeUndefined()
		expect(validateCheckoutField('email', '', digital)).toBe('Digital delivery contact is required')
		expect(validateCheckoutField('email', 'not-an-email', digital)).toBe('Please enter a valid email address')
	})
})

describe('summarizeCheckoutDelivery', () => {
	const base: CheckoutDeliveryRequirements = {
		hasDigitalDelivery: false,
		hasPhysicalDelivery: false,
		hasPickupDelivery: true,
		needsDigitalDeliveryContact: false,
		needsPhysicalAddress: false,
		isResolved: true,
		unresolvedShippingRefs: [],
	}

	test('all-pickup orders need no address', () => {
		expect(summarizeCheckoutDelivery(base)).toMatchObject({ isAllPickup: true, noAddressRequired: true, needsPhysicalAddress: false })
	})

	test('unresolved requirements still ask for an address', () => {
		expect(summarizeCheckoutDelivery({ ...base, isResolved: false })).toMatchObject({ isAllPickup: false, needsPhysicalAddress: true })
	})
})
