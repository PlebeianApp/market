import type { RichShippingInfo } from '@/lib/stores/cart'

export type ProductShippingSelection = {
	shippingRef: string
	extraCost: string
}

export type LegacyProductShippingSelection = {
	shippingRef?: string | null
	shipping?: Pick<RichShippingInfo, 'id' | 'name'> | null
	extraCost?: string | null
}

export type ProductShippingSelectionInput = ProductShippingSelection | LegacyProductShippingSelection

export type ResolvedProductShippingSelection = ProductShippingSelection & {
	option: RichShippingInfo | null
	isResolved: boolean
}

export const normalizeProductShippingSelection = (input: ProductShippingSelectionInput): ProductShippingSelection | null => {
	const shippingRef =
		(typeof input.shippingRef === 'string' && input.shippingRef.trim()) ||
		(typeof input.shipping?.id === 'string' && input.shipping.id.trim()) ||
		''

	if (!shippingRef) return null

	return {
		shippingRef,
		extraCost: typeof input.extraCost === 'string' ? input.extraCost : '',
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

		return {
			...selection,
			option,
			isResolved: option !== null,
		}
	})
}
