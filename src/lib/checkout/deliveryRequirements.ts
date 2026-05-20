export type CheckoutDeliveryMode = 'physical' | 'pickup' | 'digital'

export type CheckoutDeliveryRequirementInput = {
	products: Array<{
		id: string
		shippingMethodId?: string | null
	}>
	servicesByShippingRef: Record<string, string | null | undefined>
}

export type CheckoutDeliveryRequirements = {
	hasDigitalDelivery: boolean
	hasPhysicalDelivery: boolean
	hasPickupDelivery: boolean
	needsDigitalDeliveryContact: boolean
	needsPhysicalAddress: boolean
	isResolved: boolean
	unresolvedShippingRefs: string[]
}

const PHYSICAL_SERVICES = new Set(['standard', 'express', 'overnight'])

export function getCheckoutDeliveryMode(service: string | null | undefined): CheckoutDeliveryMode | null {
	if (service === 'digital') return 'digital'
	if (service === 'pickup') return 'pickup'
	if (service && PHYSICAL_SERVICES.has(service)) return 'physical'
	return null
}

export function resolveCheckoutDeliveryRequirements(input: CheckoutDeliveryRequirementInput): CheckoutDeliveryRequirements {
	let hasDigitalDelivery = false
	let hasPhysicalDelivery = false
	let hasPickupDelivery = false
	const unresolvedShippingRefs = new Set<string>()

	for (const product of input.products) {
		const shippingRef = product.shippingMethodId?.trim()

		if (!shippingRef) {
			unresolvedShippingRefs.add(`product:${product.id}:missing-shipping-method`)
			continue
		}

		const mode = getCheckoutDeliveryMode(input.servicesByShippingRef[shippingRef])

		if (!mode) {
			unresolvedShippingRefs.add(shippingRef)
			continue
		}

		if (mode === 'digital') {
			hasDigitalDelivery = true
		} else if (mode === 'pickup') {
			hasPickupDelivery = true
		} else {
			hasPhysicalDelivery = true
		}
	}

	return {
		hasDigitalDelivery,
		hasPhysicalDelivery,
		hasPickupDelivery,
		needsDigitalDeliveryContact: hasDigitalDelivery,
		needsPhysicalAddress: hasPhysicalDelivery,
		isResolved: unresolvedShippingRefs.size === 0,
		unresolvedShippingRefs: Array.from(unresolvedShippingRefs),
	}
}

export function isValidDigitalDeliveryContact(value: string | null | undefined): boolean {
	const trimmed = value?.trim()
	if (!trimmed) return false

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	return emailRegex.test(trimmed)
}
