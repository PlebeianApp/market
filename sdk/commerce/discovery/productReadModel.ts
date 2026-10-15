export interface ProductReadEvent {
	pubkey?: string
	created_at?: number
	content?: string
	tags: string[][]
}

export function getProductId(event: ProductReadEvent | null): string {
	return event?.tags.find((tag) => tag[0] === 'd')?.[1] || ''
}

export function getProductCoordinates(event: ProductReadEvent): string {
	return `30402:${event.pubkey}:${getProductId(event)}`
}

export function getProductTitle(event: ProductReadEvent | null): string {
	return event?.tags.find((tag) => tag[0] === 'title')?.[1] || 'Untitled Product'
}

export function getProductDescription(event: ProductReadEvent | null): string {
	return event?.content || ''
}

export function getProductSummary(event: ProductReadEvent | null): string {
	return event?.tags.find((tag) => tag[0] === 'summary')?.[1] || ''
}

export function getProductPrice(event: ProductReadEvent | null): string[] | undefined {
	return event?.tags.find((tag) => tag[0] === 'price')
}

export function getProductImages(event: ProductReadEvent | null): string[][] {
	if (!event) return []
	return event.tags.filter((tag) => tag[0] === 'image').sort((a, b) => (a[3] && b[3] ? Number.parseInt(a[3]) - Number.parseInt(b[3]) : 0))
}

export function getProductSpecs(event: ProductReadEvent | null): string[][] {
	return event?.tags.filter((tag) => tag[0] === 'spec') ?? []
}

export function getProductType(event: ProductReadEvent | null): string[] | undefined {
	return event?.tags.find((tag) => tag[0] === 'type')
}

export function getProductVisibility(event: ProductReadEvent | null): string[] | undefined {
	return event?.tags.find((tag) => tag[0] === 'visibility')
}

export function getProductStock(event: ProductReadEvent | null): string[] | undefined {
	return event?.tags.find((tag) => tag[0] === 'stock')
}

export function getProductWeight(event: ProductReadEvent | null): string[] | undefined {
	return event?.tags.find((tag) => tag[0] === 'weight')
}

export function getProductDimensions(event: ProductReadEvent | null): string[] | undefined {
	return event?.tags.find((tag) => tag[0] === 'dim')
}

export function getProductShippingOptions(event: ProductReadEvent | null): string[][] {
	return event?.tags.filter((tag) => tag[0] === 'shipping_option') ?? []
}

export function getProductCollection(event: ProductReadEvent | null): string | null {
	return event?.tags.find((tag) => tag[0] === 'collection')?.[1] || null
}

export function getProductCategories(event: ProductReadEvent | null): string[][] {
	return event?.tags.filter((tag) => tag[0] === 't') ?? []
}

export function getProductCreatedAt(event: ProductReadEvent | null): number {
	return event?.created_at || 0
}

export function getProductPubkey(event: ProductReadEvent | null): string {
	return event?.pubkey || ''
}

export function getProductLocation(event: ProductReadEvent | null): string {
	return event?.tags.find((tag) => tag[0] === 'location')?.[1] || ''
}

export function getProductContentWarning(event: ProductReadEvent | null): string[] | undefined {
	return event?.tags.find((tag) => tag[0] === 'content-warning')
}

export function isNSFWProduct(event: ProductReadEvent | null): boolean {
	return getProductContentWarning(event)?.[1] === 'nsfw'
}
