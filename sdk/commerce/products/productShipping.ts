export type ProductShippingSelection = {
	shippingRef: string
	extraCost: string
}

export type LegacyProductShippingSelection = {
	shippingRef?: string | null
	shipping?: { id: string; name?: string } | null
	extraCost?: string | null
}

export type ProductShippingSelectionInput = ProductShippingSelection | LegacyProductShippingSelection

export interface ProductShippingOption {
	id: string
	name?: string
	cost?: number
	currency?: string
	countries?: string[]
	service?: string
	carrier?: string
	[key: string]: unknown
}

export type ResolvedProductShippingSelection = ProductShippingSelection & {
	option: ProductShippingOption | null
	isResolved: boolean
}

export type ResolvedProductPageShippingOption = ProductShippingOption & {
	shippingRef: string
	baseCost: number
	extraCost: string
	extraCostAmount: number
	isResolved: true
}

export type ReusableShippingSelectionCandidate = {
	id: string
	sellerPubkey?: string | null
	shippingMethodId?: string | null
}

export type ReusableResolvedShippingOption = {
	id: string
	shippingRef?: string | null
	name?: string | null
	cost?: number | null
	currency?: string | null
}

export type ReusablePublishedShippingSelection = {
	shippingMethodId: string
	shippingMethodName: string | null
	shippingCost: number
	shippingCostCurrency: string
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export const findReusablePublishedShippingSelection = ({
	currentProductId,
	sellerPubkey,
	products,
	resolvedShippingOptions,
}: {
	currentProductId: string
	sellerPubkey: string
	products: ReusableShippingSelectionCandidate[]
	resolvedShippingOptions: ReusableResolvedShippingOption[]
}): ReusablePublishedShippingSelection | null => {
	const resolvedOptionsByRef = new Map(
		resolvedShippingOptions
			.map((option) => {
				const shippingRef = nonEmptyString(option.shippingRef)
					? option.shippingRef.trim()
					: nonEmptyString(option.id)
						? option.id.trim()
						: ''
				return [shippingRef, option] as const
			})
			.filter(([shippingRef]) => shippingRef.length > 0),
	)
	if (resolvedOptionsByRef.size === 0) return null

	for (const product of products) {
		if (product.id === currentProductId || product.sellerPubkey !== sellerPubkey) continue

		const shippingMethodId = nonEmptyString(product.shippingMethodId) ? product.shippingMethodId.trim() : ''
		const matchingOption = shippingMethodId ? resolvedOptionsByRef.get(shippingMethodId) : null
		if (!matchingOption || typeof matchingOption.cost !== 'number' || !Number.isFinite(matchingOption.cost)) continue

		const shippingCostCurrency = nonEmptyString(matchingOption.currency) ? matchingOption.currency.trim() : ''
		if (!shippingCostCurrency) continue

		return {
			shippingMethodId,
			shippingMethodName: nonEmptyString(matchingOption.name) ? matchingOption.name : null,
			shippingCost: matchingOption.cost,
			shippingCostCurrency,
		}
	}

	return null
}

export const normalizeProductShippingSelection = (input: ProductShippingSelectionInput): ProductShippingSelection | null => {
	const legacyShipping = 'shipping' in input ? input.shipping : undefined
	const shippingRef =
		(typeof input.shippingRef === 'string' && input.shippingRef.trim()) ||
		(typeof legacyShipping?.id === 'string' && legacyShipping.id.trim()) ||
		''

	if (!shippingRef) return null
	return { shippingRef, extraCost: typeof input.extraCost === 'string' ? input.extraCost : '' }
}

export const normalizeProductShippingSelections = (
	inputs: ProductShippingSelectionInput[] | null | undefined,
): ProductShippingSelection[] => {
	if (!inputs || inputs.length === 0) return []
	return inputs.map(normalizeProductShippingSelection).filter((input): input is ProductShippingSelection => input !== null)
}

export const normalizePublishedProductShippingTags = (tags: string[][] | null | undefined): ProductShippingSelection[] => {
	if (!tags || tags.length === 0) return []
	return normalizeProductShippingSelections(
		tags.filter((tag) => tag[0] === 'shipping_option').map((tag) => ({ shippingRef: tag[1] ?? '', extraCost: tag[2] ?? '' })),
	)
}

export const resolveProductShippingSelections = (
	selections: ProductShippingSelection[],
	availableOptions: ProductShippingOption[],
): ResolvedProductShippingSelection[] =>
	selections.map((selection) => {
		const option = availableOptions.find((availableOption) => availableOption.id === selection.shippingRef) ?? null
		return { ...selection, option, isResolved: option !== null }
	})

const parseShippingCost = (cost: unknown): number => {
	const parsedCost = typeof cost === 'number' ? cost : Number(cost || 0)
	return Number.isFinite(parsedCost) ? parsedCost : 0
}

export const resolvePublishedProductShippingOptions = ({
	publishedSelections,
	availableOptions,
}: {
	publishedSelections: ProductShippingSelection[]
	availableOptions: ProductShippingOption[]
}): ResolvedProductPageShippingOption[] =>
	resolveProductShippingSelections(publishedSelections, availableOptions)
		.filter(
			(selection): selection is ResolvedProductShippingSelection & { option: ProductShippingOption } =>
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
				baseCost,
				extraCost: selection.extraCost,
				extraCostAmount: extraCost,
				isResolved: true,
			}
		})

export type ProductShippingForm = ProductShippingSelection

export const attachShippingOptionByRef = (shippings: ProductShippingForm[], shippingRef: string): ProductShippingForm[] => {
	if (!shippingRef.trim() || shippings.some((shipping) => shipping.shippingRef === shippingRef)) return shippings
	return [...shippings, { shippingRef, extraCost: '' }]
}
