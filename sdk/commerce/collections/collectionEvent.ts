export const COLLECTION_EVENT_KIND = 30405

export interface CollectionShippingInput {
	shipping: { id: string; name?: string } | null
	extraCost: string
}

export interface CollectionEventInput {
	collectionId: string
	name: string
	summary: string
	description: string
	headerImageUrl?: string
	products: string[]
	shippings: CollectionShippingInput[]
	clientTag?: string[]
}

export interface CollectionEventData {
	kind: typeof COLLECTION_EVENT_KIND
	content: string
	tags: string[][]
}

/** Build the current kind-30405 event data. Signing and publishing stay in Platform. */
export function buildCollectionEventData(input: CollectionEventInput): CollectionEventData {
	const tags: string[][] = [['d', input.collectionId], ['title', input.name], ...(input.summary ? [['summary', input.summary]] : [])]

	if (input.headerImageUrl) tags.push(['image', input.headerImageUrl])
	for (const productCoordinate of input.products) tags.push(['a', productCoordinate])

	const shippingTags = input.shippings
		.filter((shipping) => shipping.shipping && shipping.shipping.id)
		.map((shipping) =>
			shipping.extraCost ? ['shipping_option', shipping.shipping!.id, shipping.extraCost] : ['shipping_option', shipping.shipping!.id],
		)
	tags.push(...shippingTags)

	if (input.clientTag) tags.push(input.clientTag)
	return { kind: COLLECTION_EVENT_KIND, content: input.description, tags }
}
