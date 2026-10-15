import { describe, expect, test } from 'bun:test'
import {
	buildShippingOptionEventData,
	prepareShippingOptionForPublish,
	validateShippingForm,
	type ShippingOptionFormInput,
} from './shippingWorkflow'

const baseForm: ShippingOptionFormInput = {
	title: 'Standard',
	description: 'Usually arrives soon',
	price: '5',
	currency: 'USD',
	countries: ['USA'],
	service: 'standard',
}

describe('seller shipping workflow', () => {
	test('preserves worldwide, pickup, and digital UI validation policies', () => {
		expect(validateShippingForm({ ...baseForm, countries: [] }, { isWorldwide: true })).toEqual({})
		expect(validateShippingForm({ ...baseForm, countries: [] }, { isWorldwide: false })).toEqual({
			countries: 'At least one country is required',
		})
		expect(validateShippingForm({ ...baseForm, service: 'digital', price: '', currency: '' }, { isWorldwide: false })).toEqual({})
		expect(
			validateShippingForm(
				{ ...baseForm, service: 'pickup', countries: [], pickupAddress: { street: '', city: '', state: '', postalCode: '', country: '' } },
				{ isWorldwide: false },
			),
		).toEqual({
			pickupStreet: 'Street address is required for local pickup',
			pickupCity: 'City is required for local pickup',
		})
	})

	test('publishing preparation fails in the existing validation order and normalizes zero-price services', () => {
		expect(prepareShippingOptionForPublish({ ...baseForm, title: ' ' })).toEqual({ ok: false, issue: 'shipping-title-required' })
		expect(prepareShippingOptionForPublish({ ...baseForm, price: 'bad' })).toEqual({ ok: false, issue: 'shipping-price-required' })
		const digital = prepareShippingOptionForPublish({ ...baseForm, service: 'digital', price: '9', currency: '' })
		expect(digital).toEqual({ ok: true, form: { ...baseForm, service: 'digital', price: '0', currency: 'USD' } })
		expect(baseForm.price).toBe('5')
		const pickupForm = {
			...baseForm,
			service: 'pickup' as const,
			pickupAddress: { street: 'Main', city: 'City', state: '', postalCode: '', country: '' },
		}
		const pickup = prepareShippingOptionForPublish(pickupForm)
		expect(pickup).toEqual({ ok: true, form: { ...pickupForm, price: '0' } })
	})

	test('builds all optional shipping tags without changing their established ordering', () => {
		const result = buildShippingOptionEventData(
			{
				...baseForm,
				countries: ['USA', 'CAN'],
				carrier: 'Carrier',
				region: 'US-CA',
				additionalRegions: ['US-NY'],
				duration: { min: '1', max: '3', unit: 'D' },
				location: 'Warehouse',
				geohash: '9q8yy',
				pickupAddress: { street: 'Main', city: 'Town', state: 'CA', postalCode: '90000', country: 'USA' },
				weightLimits: { min: { value: '1', unit: 'kg' }, max: { value: '5', unit: 'kg' } },
				dimensionLimits: { min: { value: '1x2x3', unit: 'cm' }, max: { value: '4x5x6', unit: 'cm' } },
				priceCalculations: {
					weight: { value: '2', unit: 'kg' },
					volume: { value: '3', unit: 'm3' },
					distance: { value: '4', unit: 'km' },
				},
			},
			'ship-all',
		)
		expect(result.tags).toEqual([
			['d', 'ship-all'],
			['title', 'Standard'],
			['price', '5', 'USD'],
			['service', 'standard'],
			['country', 'USA', 'CAN'],
			['carrier', 'Carrier'],
			['region', 'US-CA', 'US-NY'],
			['duration', '1', '3', 'D'],
			['location', 'Warehouse'],
			['g', '9q8yy'],
			['pickup-street', 'Main'],
			['pickup-city', 'Town'],
			['pickup-state', 'CA'],
			['pickup-postal-code', '90000'],
			['pickup-country', 'USA'],
			['pickup-address', 'Main, Town, CA, 90000, USA'],
			['weight-min', '1', 'kg'],
			['weight-max', '5', 'kg'],
			['dim-min', '1x2x3', 'cm'],
			['dim-max', '4x5x6', 'cm'],
			['price-weight', '2', 'kg'],
			['price-volume', '3', 'm3'],
			['price-distance', '4', 'km'],
		])
	})

	test('builds kind-30406 shipping tags with worldwide and pickup compatibility behavior', () => {
		expect(buildShippingOptionEventData({ ...baseForm, countries: [] }, 'ship-1')).toEqual({
			kind: 30406,
			content: 'Usually arrives soon',
			tags: [
				['d', 'ship-1'],
				['title', 'Standard'],
				['price', '5', 'USD'],
				['service', 'standard'],
			],
		})
		const pickup = buildShippingOptionEventData(
			{
				...baseForm,
				service: 'pickup',
				pickupAddress: { street: 'Main', city: 'Town', state: 'CA', postalCode: '90000', country: 'USA' },
			},
			'pickup-1',
		)
		expect(pickup.tags).toContainEqual(['country', 'USA'])
		expect(pickup.tags).toContainEqual(['pickup-address', 'Main, Town, CA, 90000, USA'])
	})
})
