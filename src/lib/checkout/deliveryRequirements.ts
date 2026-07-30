export type CheckoutDeliveryMode = 'physical' | 'pickup' | 'digital'

export type CheckoutDeliveryRequirementInput = {
	products: Array<{
		id: string
		shippingMethodId?: string | null
		// Optional product-level hint - "digital" | "physical" - when available
		productType?: 'digital' | 'physical'
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
		// If product explicitly declares its type as digital, treat it as digital delivery
		if (product.productType === 'digital') {
			hasDigitalDelivery = true
			continue
		}

		// If product type is unknown, delivery requirements cannot be resolved by product type alone.
		if (!product.productType) {
			unresolvedShippingRefs.add(`product:${product.id}:missing-product-type`)
			continue
		}

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

		if (product.productType === 'physical') {
			if (mode === 'pickup') {
				hasPickupDelivery = true
			} else {
				hasPhysicalDelivery = true
			}
		} else {
			// This should not happen, but keep compatibility if type is unexpectedly set.
			if (mode === 'digital') {
				hasDigitalDelivery = true
			} else if (mode === 'pickup') {
				hasPickupDelivery = true
			} else {
				hasPhysicalDelivery = true
			}
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
