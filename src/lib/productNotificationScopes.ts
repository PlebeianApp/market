export const PRODUCT_KIND = 30402

export type ProductScopeTag = '#a' | '#A' | '#E'

export type ProductScopeEvent = {
	id: string
	kind: number
	pubkey: string
	tags: string[][]
}

export type ProductNotificationScope = {
	eventId: string
	coordinate: string
	productKey: string
}

export type SellerProductScopeRegistry = {
	productKeyByEventId: Map<string, string>
	productKeyByCoordinate: Map<string, string>
	subscribedEventIds: Set<string>
	subscribedCoordinates: Set<string>
}

export const getProductNotificationScope = (event: ProductScopeEvent): ProductNotificationScope | null => {
	const dTag = event.tags.find((tag) => tag[0] === 'd')
	if (!event.id || !dTag || typeof dTag[1] !== 'string') return null

	const coordinate = `${PRODUCT_KIND}:${event.pubkey}:${dTag[1]}`
	return {
		eventId: event.id,
		coordinate,
		productKey: coordinate,
	}
}

export const getSellerProductNotificationScope = (event: ProductScopeEvent, sellerPubkey: string): ProductNotificationScope | null => {
	if (event.kind !== PRODUCT_KIND || event.pubkey !== sellerPubkey || !event.id) return null
	return getProductNotificationScope(event)
}

export const registerSellerProductNotificationScope = (
	event: ProductScopeEvent,
	sellerPubkey: string,
	registry: SellerProductScopeRegistry,
	subscribe: (tagName: ProductScopeTag, value: string) => void,
): string => {
	const scope = getSellerProductNotificationScope(event, sellerPubkey)
	if (!scope) return ''

	const { eventId, coordinate, productKey } = scope
	if (!productKey) return ''

	registry.productKeyByEventId.set(eventId, productKey)
	if (!registry.subscribedEventIds.has(eventId)) {
		registry.subscribedEventIds.add(eventId)
		subscribe('#E', eventId)
	}

	if (coordinate) {
		registry.productKeyByCoordinate.set(coordinate, productKey)
		if (!registry.subscribedCoordinates.has(coordinate)) {
			registry.subscribedCoordinates.add(coordinate)
			subscribe('#a', coordinate)
			subscribe('#A', coordinate)
		}
	}

	return productKey
}
