import { SHIPPING_OPTION_KIND } from './shippingWorkflow'

/** Minimal kind-30406 event shape needed for reads; relay data stays untrusted until these helpers parse it. */
export interface ShippingReadEvent {
	tags: string[][]
	content?: string
	created_at?: number
	pubkey: string
}

const findTag = (event: ShippingReadEvent, name: string) => event.tags.find((tag) => tag[0] === name)

export const getShippingTitle = (event: ShippingReadEvent): string => findTag(event, 'title')?.[1] || 'Standard Shipping'

export const getShippingDescription = (event: ShippingReadEvent): string => event.content || ''

/** `['price', amount, currency]` tag, if present. */
export const getShippingPrice = (event: ShippingReadEvent) => findTag(event, 'price')

/** `['country', ...codes]` tag, if present; missing means worldwide. */
export const getShippingCountry = (event: ShippingReadEvent) => findTag(event, 'country')

export const getShippingService = (event: ShippingReadEvent) => findTag(event, 'service')

export const getShippingCarrier = (event: ShippingReadEvent) => findTag(event, 'carrier')

export const getShippingLocation = (event: ShippingReadEvent) => findTag(event, 'location')

/** `['duration', min, max, unit]` tag, if present. */
export const getShippingDuration = (event: ShippingReadEvent) => findTag(event, 'duration')

export interface ShippingPickupAddress {
	street: string
	city: string
	state: string
	postalCode: string
	country: string
}

/** Structured pickup tags, falling back to the legacy single `pickup-address` tag in `street`. */
export const getShippingPickupAddress = (event: ShippingReadEvent): ShippingPickupAddress | null => {
	const street = findTag(event, 'pickup-street')?.[1]
	const city = findTag(event, 'pickup-city')?.[1]
	const state = findTag(event, 'pickup-state')?.[1]
	const postalCode = findTag(event, 'pickup-postal-code')?.[1]
	const country = findTag(event, 'pickup-country')?.[1]

	if (street || city || state || postalCode || country) {
		return { street: street || '', city: city || '', state: state || '', postalCode: postalCode || '', country: country || '' }
	}

	const legacyAddress = findTag(event, 'pickup-address')?.[1]
	if (legacyAddress) return { street: legacyAddress, city: '', state: '', postalCode: '', country: '' }

	return null
}

export const getShippingPickupAddressString = (event: ShippingReadEvent): string | null => {
	const address = getShippingPickupAddress(event)
	if (!address) return null
	if (address.street && !address.city && !address.state && !address.postalCode && !address.country) return address.street
	return [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')
}

export const getShippingWeightLimits = (event: ShippingReadEvent) => ({
	min: findTag(event, 'weight-min'),
	max: findTag(event, 'weight-max'),
})

export const getShippingDimensionLimits = (event: ShippingReadEvent) => ({ min: findTag(event, 'dim-min'), max: findTag(event, 'dim-max') })

export const getShippingCreatedAt = (event: ShippingReadEvent): number => event.created_at || 0

export const getShippingPubkey = (event: ShippingReadEvent): string => event.pubkey

/** The `d` tag value. */
export const getShippingId = (event: ShippingReadEvent): string | undefined => findTag(event, 'd')?.[1]

/** Addressable reference `30406:<pubkey>:<d>`. */
export const createShippingReference = (pubkey: string, id: string): string => `${SHIPPING_OPTION_KIND}:${pubkey}:${id}`

/** Accepts either `30406:<pubkey>:<d>` or a bare `d` value and returns the `d` value. */
export const parseShippingReference = (reference: string): string => {
	if (reference.includes(':')) {
		const parts = reference.split(':')
		if (parts.length === 3 && parts[0] === SHIPPING_OPTION_KIND.toString()) return parts[2]
	}
	return reference
}

/** Display-ready shipping option, or null when `d`, title, price, or service is missing. */
export const getShippingInfo = (event: ShippingReadEvent | null | undefined) => {
	if (!event) return null

	const id = getShippingId(event)
	const title = getShippingTitle(event)
	const priceTag = getShippingPrice(event)
	const countryTag = getShippingCountry(event) || ['country']
	const serviceTag = getShippingService(event)

	if (!id || !title || !priceTag || !serviceTag) return null

	const duration = getShippingDuration(event)
	const weight = getShippingWeightLimits(event)
	const dimensions = getShippingDimensionLimits(event)

	return {
		id,
		title,
		description: getShippingDescription(event),
		price: { amount: priceTag[1], currency: priceTag[2] },
		countries: countryTag.slice(1),
		service: serviceTag[1],
		carrier: getShippingCarrier(event)?.[1],
		location: getShippingLocation(event)?.[1],
		duration: duration ? { min: duration[1], max: duration[2], unit: duration[3] } : undefined,
		weightLimits: { min: weight.min?.[1], minUnit: weight.min?.[2], max: weight.max?.[1], maxUnit: weight.max?.[2] },
		dimensionLimits: { min: dimensions.min?.[1], minUnit: dimensions.min?.[2], max: dimensions.max?.[1], maxUnit: dimensions.max?.[2] },
		sellerPubkey: getShippingPubkey(event),
		createdAt: getShippingCreatedAt(event),
	}
}
