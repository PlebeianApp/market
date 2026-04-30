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

export type ResolvedProductPageShippingOption = RichShippingInfo & {
	shippingRef: string
	extraCost: string
	isResolved: true
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

export const normalizePublishedProductShippingTags = (tags: string[][] | null | undefined): ProductShippingSelection[] => {
	if (!tags || tags.length === 0) return []

	return normalizeProductShippingSelections(
		tags
			.filter((tag) => tag[0] === 'shipping_option')
			.map((tag) => ({
				shippingRef: tag[1] ?? '',
				extraCost: tag[2] ?? '',
			})),
	)
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

const parseShippingCost = (cost: unknown): number => {
	const parsedCost = typeof cost === 'number' ? cost : Number(cost || 0)
	return Number.isFinite(parsedCost) ? parsedCost : 0
}

export const resolvePublishedProductShippingOptions = ({
	publishedSelections,
	availableOptions,
}: {
	publishedSelections: ProductShippingSelection[]
	availableOptions: RichShippingInfo[]
}): ResolvedProductPageShippingOption[] => {
	return resolveProductShippingSelections(publishedSelections, availableOptions)
		.filter(
			(selection): selection is ResolvedProductShippingSelection & { option: RichShippingInfo } =>
				selection.isResolved && selection.option !== null,
		)
		.map((selection) => {
			const extraCost = parseShippingCost(selection.extraCost)
			const baseCost = parseShippingCost(selection.option.cost)

			return {
				...selection.option,
				id: selection.option.id,
				cost: baseCost + extraCost,
				shippingRef: selection.shippingRef,
				extraCost: selection.extraCost,
				isResolved: true,
			}
		})
}
