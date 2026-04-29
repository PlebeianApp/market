import { beforeAll, describe, expect, test } from 'bun:test'
import { buildPublishedShippingOption, type ShippingFormData } from '@/publish/shipping'

let normalizeShippingFormDataForDeliveryMode: (formData: ShippingFormData, defaultCurrency: string) => ShippingFormData

beforeAll(async () => {
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		},
	})
	;({ normalizeShippingFormDataForDeliveryMode } = await import('@/routes/_dashboard-layout/dashboard/products/shipping-options'))
})

describe('published shipping option identity', () => {
	test('derives canonical shippingRef from mutation result identity', () => {
		expect(buildPublishedShippingOption('event-123', 'merchant-pubkey', 'shipping_abc')).toEqual({
			eventId: 'event-123',
			shippingDTag: 'shipping_abc',
			shippingRef: '30406:merchant-pubkey:shipping_abc',
		})
	})
})

const physicalDraftWithMetadata = (service: ShippingFormData['service'] | string): ShippingFormData =>
	({
		title: 'Existing shipping option',
		description: 'Existing instructions',
		price: '12.50',
		currency: 'USD',
		countries: ['USA', 'CAN'],
		service,
		carrier: 'UPS',
		location: 'Warehouse 1',
		region: 'US-CA',
		additionalRegions: ['US-NV'],
		geohash: '9q8yy',
		duration: {
			min: '2',
			max: '5',
			unit: 'D',
		},
		weightLimits: {
			min: { value: '1', unit: 'kg' },
			max: { value: '10', unit: 'kg' },
		},
		dimensionLimits: {
			min: { value: '10x10x10', unit: 'cm' },
			max: { value: '100x100x100', unit: 'cm' },
		},
		priceCalculations: {
			weight: { value: '1.5', unit: 'kg' },
		},
	}) as ShippingFormData

const expectNoPhysicalMetadata = (formData: ShippingFormData) => {
	expect(formData).not.toHaveProperty('carrier')
	expect(formData).not.toHaveProperty('location')
	expect(formData).not.toHaveProperty('region')
	expect(formData).not.toHaveProperty('additionalRegions')
	expect(formData).not.toHaveProperty('geohash')
	expect(formData).not.toHaveProperty('duration')
	expect(formData).not.toHaveProperty('weightLimits')
	expect(formData).not.toHaveProperty('dimensionLimits')
	expect(formData).not.toHaveProperty('priceCalculations')
}

describe('shipping option delivery-mode normalization', () => {
	test('physical to digital strips hidden physical metadata before persistence', () => {
		const normalized = normalizeShippingFormDataForDeliveryMode(physicalDraftWithMetadata('digital-delivery'), 'USD')

		expect(normalized.service).toBe('digital')
		expect(normalized.price).toBe('0')
		expect(normalized.countries).toEqual([])
		expect(normalized.description).toBe('Existing instructions')
		expectNoPhysicalMetadata(normalized)
	})

	test('physical to pickup strips hidden physical metadata before persistence', () => {
		const normalized = normalizeShippingFormDataForDeliveryMode(
			{
				...physicalDraftWithMetadata('local-pickup'),
				pickupAddress: {
					street: '123 Main St',
					city: 'Austin',
					state: 'TX',
					postalCode: '78701',
					country: 'USA',
				},
			},
			'USD',
		)

		expect(normalized.service).toBe('pickup')
		expect(normalized.price).toBe('0')
		expect(normalized.countries).toEqual(['USA'])
		expect(normalized.description).toBe('Existing instructions')
		expect(normalized.pickupAddress).toEqual({
			street: '123 Main St',
			city: 'Austin',
			state: 'TX',
			postalCode: '78701',
			country: 'USA',
		})
		expectNoPhysicalMetadata(normalized)
	})

	test('physical mode preserves physical metadata before persistence', () => {
		const draft = physicalDraftWithMetadata('express')
		const normalized = normalizeShippingFormDataForDeliveryMode(draft, 'USD')

		expect(normalized).toEqual(draft)
	})
})
