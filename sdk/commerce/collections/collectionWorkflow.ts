export interface CollectionWorkflowEvent {
	pubkey: string
	content: string
	tags: string[][]
}

export interface CollectionShippingSelection {
	shipping: { id: string; name: string } | null
	extraCost: string
}

export interface CollectionEditDraft {
	editingCollectionId: string
	name: string
	summary: string
	description: string
	headerImageUrl: string
	selectedProducts: string[]
	shippings: CollectionShippingSelection[]
}

/** Project a seller-owned collection event into its current editable fields. */
export function createCollectionEditDraft(event: CollectionWorkflowEvent): CollectionEditDraft {
	const tags = event.tags
	const id = tags.find((tag) => tag[0] === 'd')?.[1] || ''
	const name = tags.find((tag) => tag[0] === 'title')?.[1] || ''
	const summary = tags.find((tag) => tag[0] === 'summary')?.[1] || ''
	const headerImageUrl = tags.find((tag) => tag[0] === 'image')?.[1] || ''
	const selectedProducts = tags.filter((tag) => tag[0] === 'a').map((tag) => tag[1])
	const shippings = tags
		.filter((tag) => tag[0] === 'shipping_option')
		.map((tag) => ({
			shipping: {
				id: tag[1] ?? '',
				name: `Shipping Option (${tag[1]?.split(':')[2] || 'unknown'})`,
			},
			extraCost: tag[2] || '',
		}))

	return {
		editingCollectionId: id,
		name,
		summary,
		description: event.content || '',
		headerImageUrl,
		selectedProducts,
		shippings,
	}
}

/** Preserve current append behavior (including duplicate coordinates). */
export function addProductToCollectionSelection(selectedProducts: readonly string[], productCoordinates: string): string[] {
	return [...selectedProducts, productCoordinates]
}

export function removeProductFromCollectionSelection(selectedProducts: readonly string[], productCoordinates: string): string[] {
	return selectedProducts.filter((product) => product !== productCoordinates)
}
