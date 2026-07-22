import type { RichShippingInfo } from '@/lib/stores/cart'
import type { getShippingInfo } from '@/queries/shipping'

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
		if (product.id === currentProductId) continue
		if (product.sellerPubkey !== sellerPubkey) continue

		const shippingMethodId = nonEmptyString(product.shippingMethodId) ? product.shippingMethodId.trim() : ''
		const matchingOption = shippingMethodId ? resolvedOptionsByRef.get(shippingMethodId) : null
		if (!matchingOption) continue
		if (typeof matchingOption.cost !== 'number' || !Number.isFinite(matchingOption.cost)) continue

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
	const legacyShipping = 'shipping' in input ? input.shipping : null
	const shippingRef =
		(typeof input.shippingRef === 'string' && input.shippingRef.trim()) ||
		(typeof legacyShipping?.id === 'string' && legacyShipping.id.trim()) ||
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
				baseCost,
				extraCost: selection.extraCost,
				extraCostAmount: extraCost,
				isResolved: true,
			}
		})
}

// Helpers for UI: convert between base+extra and total, and format values for inputs
export const getProductShippingTotalCost = (baseCost: number | undefined, extraCost: string): number => {
	const base = typeof baseCost === 'number' && Number.isFinite(baseCost) ? baseCost : 0
	const extra = Number(extraCost) || 0
	return base + extra
}

export const getProductShippingExtraCostFromTotal = (baseCost: number | undefined, totalCost: string): string => {
	const base = typeof baseCost === 'number' && Number.isFinite(baseCost) ? baseCost : 0
	const total = Number(totalCost)
	if (!Number.isFinite(total)) return ''
	const extra = total - base
	return extra === 0 ? '' : String(Number(extra.toFixed(2)))
}

export const formatShippingCostForInput = (cost: number | string | null | undefined): string => {
	if (cost === null || cost === undefined || cost === '') return ''
	const n = typeof cost === 'number' ? cost : Number(cost)
	if (!Number.isFinite(n)) return ''
	return String(Number(n.toFixed(2)))
}

export const formatShippingDisplayText = (shippingRef: string | undefined, shippingOption: ReturnType<typeof getShippingInfo> | null) => {
	if (!shippingRef) return ''
	if (!shippingOption) return shippingRef

	const amount = shippingOption.price?.amount
	const currency = shippingOption.price?.currency
	const costLabel = amount !== undefined && amount !== null && amount !== '' ? `${amount}${currency ? ` ${currency}` : ''}` : ''
	const title = shippingOption.title?.trim()

	if (!title) return shippingRef
	return costLabel ? `${title} • ${costLabel}` : title
}
