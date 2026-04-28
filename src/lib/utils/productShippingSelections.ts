import type { RichShippingInfo } from '@/lib/stores/cart'

export type ProductShippingSelection = {
	shippingRef: string
	extraCost: string
	service?: string
}

export type LegacyProductShippingSelection = {
	shippingRef?: string | null
	shipping?: Pick<RichShippingInfo, 'id' | 'name' | 'service'> | null
	extraCost?: string | null
	service?: string | null
}

export type ProductShippingSelectionInput = ProductShippingSelection | LegacyProductShippingSelection

export type ResolvedProductShippingSelection = ProductShippingSelection & {
	option: RichShippingInfo | null
	isResolved: boolean
}

export const sanitizeProductShippingExtraCostInput = (input: string): string | null => {
	const value = input.trim()
	if (!value) return ''
	if (!/^\d*(?:\.\d*)?$/.test(value)) return null

	const [whole = '', decimal = ''] = value.split('.')
	if (value.includes('.') && decimal.length > 2) {
		return `${whole || '0'}.${decimal.slice(0, 2)}`
	}

	return value
}

export const normalizeProductShippingExtraCost = (input: string | null | undefined): string => {
	const sanitized = sanitizeProductShippingExtraCostInput(input ?? '')
	if (!sanitized || sanitized === '.') return ''
	return sanitized.endsWith('.') ? sanitized.slice(0, -1) : sanitized
}

export const shippingServiceDisallowsProductExtraCost = (service: string | null | undefined): boolean => {
	return service === 'digital' || service === 'pickup'
}

export const normalizeProductShippingSelection = (input: ProductShippingSelectionInput): ProductShippingSelection | null => {
	const shippingRef =
		(typeof input.shippingRef === 'string' && input.shippingRef.trim()) ||
		(typeof input.shipping?.id === 'string' && input.shipping.id.trim()) ||
		''
	const service =
		(typeof input.service === 'string' && input.service.trim()) ||
		(typeof input.shipping?.service === 'string' && input.shipping.service.trim()) ||
		undefined

	if (!shippingRef) return null

	return {
		shippingRef,
		extraCost: shippingServiceDisallowsProductExtraCost(service) ? '' : normalizeProductShippingExtraCost(input.extraCost),
		...(service ? { service } : {}),
	}
}

export const normalizeProductShippingSelections = (
	inputs: ProductShippingSelectionInput[] | null | undefined,
): ProductShippingSelection[] => {
	if (!inputs || inputs.length === 0) return []

	return inputs
		.map((input) => normalizeProductShippingSelection(input))
		.filter((input): input is ProductShippingSelection => input !== null)
}

export const resolveProductShippingSelections = (
	selections: ProductShippingSelection[],
	availableOptions: RichShippingInfo[],
): ResolvedProductShippingSelection[] => {
	return selections.map((selection) => {
		const option = availableOptions.find((availableOption) => availableOption.id === selection.shippingRef) ?? null
		const service = option?.service || selection.service
		const extraCost = shippingServiceDisallowsProductExtraCost(service) ? '' : normalizeProductShippingExtraCost(selection.extraCost)

		return {
			...selection,
			extraCost,
			...(service ? { service } : {}),
			option,
			isResolved: option !== null,
		}
	})
}
