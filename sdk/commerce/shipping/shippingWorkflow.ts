export const SHIPPING_OPTION_KIND = 30406

export type ShippingService = 'standard' | 'express' | 'overnight' | 'pickup' | 'digital'
export type ShippingDurationUnit = 'D' | 'W' | 'M'

export interface ShippingOptionFormInput {
	title: string
	description: string
	price: string
	currency: string
	countries: string[]
	service: ShippingService
	carrier?: string
	region?: string
	additionalRegions?: string[]
	duration?: { min: string; max: string; unit: ShippingDurationUnit }
	location?: string
	geohash?: string
	pickupAddress?: { street: string; city: string; state: string; postalCode: string; country: string }
	weightLimits?: { min?: { value: string; unit: string }; max?: { value: string; unit: string } }
	dimensionLimits?: { min?: { value: string; unit: string }; max?: { value: string; unit: string } }
	priceCalculations?: {
		weight?: { value: string; unit: string }
		volume?: { value: string; unit: string }
		distance?: { value: string; unit: string }
	}
}

export type ShippingFormValidationErrors = Partial<
	Record<'title' | 'description' | 'price' | 'currency' | 'countries' | 'pickupStreet' | 'pickupCity', string>
>

/** Pure UI validation, including explicit worldwide and pickup/digital rules. */
export function validateShippingForm(form: ShippingOptionFormInput, options: { isWorldwide: boolean }): ShippingFormValidationErrors {
	const errors: ShippingFormValidationErrors = {}
	if (!form.title.trim()) errors.title = 'Title is required'
	if (!form.description.trim()) errors.description = 'Description is required'

	if (form.service !== 'digital') {
		if (!form.price.trim()) errors.price = 'Price is required'
		else if (isNaN(Number(form.price))) errors.price = 'Price must be a valid number'
		if (!form.currency.trim()) errors.currency = 'Currency is required'
	}

	if (form.service !== 'pickup' && form.service !== 'digital' && !options.isWorldwide && !form.countries.length) {
		errors.countries = 'At least one country is required'
	}
	if (form.service === 'pickup') {
		if (!form.pickupAddress?.street?.trim()) errors.pickupStreet = 'Street address is required for local pickup'
		if (!form.pickupAddress?.city?.trim()) errors.pickupCity = 'City is required for local pickup'
	}
	return errors
}

export type ShippingPublishValidationIssue =
	| 'shipping-title-required'
	| 'shipping-description-required'
	| 'shipping-price-required'
	| 'shipping-currency-required'
	| 'shipping-service-required'
	| 'shipping-pickup-street-required'
	| 'shipping-pickup-city-required'

export type ShippingPublishPreparation = { ok: true; form: ShippingOptionFormInput } | { ok: false; issue: ShippingPublishValidationIssue }

/** Validate and normalize a copy for publishing; never mutate caller-owned form state. */
export function prepareShippingOptionForPublish(form: ShippingOptionFormInput): ShippingPublishPreparation {
	if (!form.title.trim()) return { ok: false, issue: 'shipping-title-required' }
	if (!form.description.trim()) return { ok: false, issue: 'shipping-description-required' }

	let price = form.price
	let currency = form.currency
	if (form.service !== 'digital') {
		if (!price.trim() || isNaN(Number(price))) return { ok: false, issue: 'shipping-price-required' }
		if (!currency.trim()) return { ok: false, issue: 'shipping-currency-required' }
	}
	if (!form.service) return { ok: false, issue: 'shipping-service-required' }
	if (form.service === 'pickup') {
		if (!form.pickupAddress?.street?.trim()) return { ok: false, issue: 'shipping-pickup-street-required' }
		if (!form.pickupAddress?.city?.trim()) return { ok: false, issue: 'shipping-pickup-city-required' }
		price = '0'
	}
	if (form.service === 'digital') {
		price = '0'
		currency = currency || 'USD'
	}
	return { ok: true, form: { ...form, price, currency } }
}

export interface ShippingOptionEventData {
	kind: typeof SHIPPING_OPTION_KIND
	content: string
	tags: string[][]
}

/** Build current kind-30406 tags in the established order; ID generation/signing stay in Platform. */
export function buildShippingOptionEventData(form: ShippingOptionFormInput, shippingId: string): ShippingOptionEventData {
	const tags: string[][] = [
		['d', shippingId],
		['title', form.title],
		['price', form.price, form.currency],
		['service', form.service],
	]

	if (form.service === 'pickup') tags.push(['country', form.pickupAddress?.country || 'USA'])
	else if (form.countries.length > 0) tags.push(['country', ...form.countries])

	if (form.carrier) tags.push(['carrier', form.carrier])
	if (form.region) tags.push(['region', form.region, ...(form.additionalRegions || [])])
	if (form.duration) tags.push(['duration', form.duration.min, form.duration.max, form.duration.unit])
	if (form.location) tags.push(['location', form.location])
	if (form.geohash) tags.push(['g', form.geohash])

	if (form.pickupAddress) {
		const address = form.pickupAddress
		if (address.street) tags.push(['pickup-street', address.street])
		if (address.city) tags.push(['pickup-city', address.city])
		if (address.state) tags.push(['pickup-state', address.state])
		if (address.postalCode) tags.push(['pickup-postal-code', address.postalCode])
		if (address.country) tags.push(['pickup-country', address.country])
		const fullAddress = [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')
		if (fullAddress) tags.push(['pickup-address', fullAddress])
	}

	if (form.weightLimits?.min) tags.push(['weight-min', form.weightLimits.min.value, form.weightLimits.min.unit])
	if (form.weightLimits?.max) tags.push(['weight-max', form.weightLimits.max.value, form.weightLimits.max.unit])
	if (form.dimensionLimits?.min) tags.push(['dim-min', form.dimensionLimits.min.value, form.dimensionLimits.min.unit])
	if (form.dimensionLimits?.max) tags.push(['dim-max', form.dimensionLimits.max.value, form.dimensionLimits.max.unit])
	if (form.priceCalculations?.weight) tags.push(['price-weight', form.priceCalculations.weight.value, form.priceCalculations.weight.unit])
	if (form.priceCalculations?.volume) tags.push(['price-volume', form.priceCalculations.volume.value, form.priceCalculations.volume.unit])
	if (form.priceCalculations?.distance)
		tags.push(['price-distance', form.priceCalculations.distance.value, form.priceCalculations.distance.unit])

	return { kind: SHIPPING_OPTION_KIND, content: form.description, tags }
}
