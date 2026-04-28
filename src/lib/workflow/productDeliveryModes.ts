export const PRODUCT_DELIVERY_MODES = ['pickup', 'digital', 'physical'] as const

export type ProductDeliveryMode = (typeof PRODUCT_DELIVERY_MODES)[number]

export type ProductDeliveryModeInput =
	| string
	| null
	| undefined
	| {
			service?: string | null
			name?: string | null
			title?: string | null
	  }

const normalizeDeliveryModeInput = (input: ProductDeliveryModeInput): string => {
	const value =
		typeof input === 'string'
			? input
			: typeof input?.service === 'string'
				? input.service
				: typeof input?.title === 'string'
					? input.title
					: typeof input?.name === 'string'
						? input.name
						: ''

	return value.trim().toLowerCase().replace(/[_-]+/g, ' ')
}

export const resolveProductDeliveryMode = (input: ProductDeliveryModeInput): ProductDeliveryMode => {
	const normalized = normalizeDeliveryModeInput(input)

	if (!normalized) return 'physical'
	if (normalized.includes('digital') || normalized.includes('download') || normalized.includes('virtual')) return 'digital'
	if (normalized.includes('pickup') || normalized.includes('pick up') || normalized.includes('collection')) return 'pickup'

	return 'physical'
}

export const productDeliveryModeAllowsProductExtraCost = (mode: ProductDeliveryMode): boolean => mode === 'physical'

export const productDeliveryModeRequiresShippingCost = (mode: ProductDeliveryMode): boolean => mode === 'physical'

export const productDeliveryModeUsesCoverage = (mode: ProductDeliveryMode): boolean => mode === 'physical'

export const shippingServiceAllowsProductExtraCost = (service: string | null | undefined): boolean => {
	return productDeliveryModeAllowsProductExtraCost(resolveProductDeliveryMode(service))
}

export const shippingServiceDisallowsProductExtraCost = (service: string | null | undefined): boolean => {
	return !shippingServiceAllowsProductExtraCost(service)
}

export const getProductDeliveryModeLabel = (mode: ProductDeliveryMode): string => {
	switch (mode) {
		case 'pickup':
			return 'Local pickup'
		case 'digital':
			return 'Digital delivery'
		case 'physical':
			return 'Physical shipping'
	}
}
