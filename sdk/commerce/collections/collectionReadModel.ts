export interface CollectionReadEvent {
	pubkey: string
	tags: string[][]
}

export function getCollectionTitle(event: CollectionReadEvent | null): string {
	return event?.tags.find((tag) => tag[0] === 'title')?.[1] || 'Untitled Collection'
}

export function getCollectionSummary(event: CollectionReadEvent | null): string {
	return event?.tags.find((tag) => tag[0] === 'summary')?.[1] || 'No summary available.'
}

export function getCollectionId(event: CollectionReadEvent): string {
	return event.tags.find((tag) => tag[0] === 'd')?.[1] || ''
}

export function getCollectionImages(event: CollectionReadEvent | null): string[][] {
	if (!event) return []
	return event.tags.filter((tag) => tag[0] === 'image').sort(() => 0)
}

export function getCollectionShippingOptions(event: CollectionReadEvent | null): string[][] {
	return event?.tags.filter((tag) => tag[0] === 'shipping_option') ?? []
}

export function getCollectionCoordinates(event: CollectionReadEvent): string {
	return `30405:${event.pubkey}:${getCollectionId(event)}`
}
