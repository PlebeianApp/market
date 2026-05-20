import { describe, expect, test } from 'bun:test'
import { isValidDigitalDeliveryContact, resolveCheckoutDeliveryRequirements } from '@/lib/checkout/deliveryRequirements'

const product = (id: string, shippingMethodId?: string | null) => ({ id, shippingMethodId })

describe('resolveCheckoutDeliveryRequirements', () => {
	test('digital-only cart requires delivery contact and not physical address', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('digital-product', '30406:seller:digital')],
			servicesByShippingRef: {
				'30406:seller:digital': 'digital',
			},
		})

		expect(requirements).toMatchObject({
			hasDigitalDelivery: true,
			hasPhysicalDelivery: false,
			hasPickupDelivery: false,
			needsDigitalDeliveryContact: true,
			needsPhysicalAddress: false,
			isResolved: true,
		})
	})

	test('physical-only cart requires physical address and not contact', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('physical-product', '30406:seller:standard')],
			servicesByShippingRef: {
				'30406:seller:standard': 'standard',
			},
		})

		expect(requirements).toMatchObject({
			hasDigitalDelivery: false,
			hasPhysicalDelivery: true,
			hasPickupDelivery: false,
			needsDigitalDeliveryContact: false,
			needsPhysicalAddress: true,
			isResolved: true,
		})
	})

	test('pickup-only cart requires neither physical address nor contact', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('pickup-product', '30406:seller:pickup')],
			servicesByShippingRef: {
				'30406:seller:pickup': 'pickup',
			},
		})

		expect(requirements).toMatchObject({
			hasDigitalDelivery: false,
			hasPhysicalDelivery: false,
			hasPickupDelivery: true,
			needsDigitalDeliveryContact: false,
			needsPhysicalAddress: false,
			isResolved: true,
		})
	})

	test('mixed digital and pickup requires contact and not physical address', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('digital-product', '30406:seller:digital'), product('pickup-product', '30406:seller:pickup')],
			servicesByShippingRef: {
				'30406:seller:digital': 'digital',
				'30406:seller:pickup': 'pickup',
			},
		})

		expect(requirements).toMatchObject({
			hasDigitalDelivery: true,
			hasPhysicalDelivery: false,
			hasPickupDelivery: true,
			needsDigitalDeliveryContact: true,
			needsPhysicalAddress: false,
			isResolved: true,
		})
	})

	test('mixed digital and physical requires contact and physical address', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('digital-product', '30406:seller:digital'), product('physical-product', '30406:seller:express')],
			servicesByShippingRef: {
				'30406:seller:digital': 'digital',
				'30406:seller:express': 'express',
			},
		})

		expect(requirements).toMatchObject({
			hasDigitalDelivery: true,
			hasPhysicalDelivery: true,
			hasPickupDelivery: false,
			needsDigitalDeliveryContact: true,
			needsPhysicalAddress: true,
			isResolved: true,
		})
	})

	test('missing shipping method is unresolved', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('missing-method', null)],
			servicesByShippingRef: {},
		})

		expect(requirements.isResolved).toBe(false)
		expect(requirements.unresolvedShippingRefs).toEqual(['product:missing-method:missing-shipping-method'])
	})

	test('missing service for selected shipping ref is unresolved', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('unknown-service', '30406:seller:unknown')],
			servicesByShippingRef: {
				'30406:seller:unknown': null,
			},
		})

		expect(requirements.isResolved).toBe(false)
		expect(requirements.unresolvedShippingRefs).toEqual(['30406:seller:unknown'])
	})

	test('unknown service is unresolved instead of guessed', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('drone-service', '30406:seller:drone')],
			servicesByShippingRef: {
				'30406:seller:drone': 'drone',
			},
		})

		expect(requirements.isResolved).toBe(false)
		expect(requirements.unresolvedShippingRefs).toEqual(['30406:seller:drone'])
		expect(requirements.needsPhysicalAddress).toBe(false)
		expect(requirements.needsDigitalDeliveryContact).toBe(false)
	})

	test('unresolved delivery requirement fails closed', () => {
		const requirements = resolveCheckoutDeliveryRequirements({
			products: [product('digital-product', '30406:seller:digital'), product('missing-service', '30406:seller:missing')],
			servicesByShippingRef: {
				'30406:seller:digital': 'digital',
			},
		})

		expect(requirements.hasDigitalDelivery).toBe(true)
		expect(requirements.needsDigitalDeliveryContact).toBe(true)
		expect(requirements.isResolved).toBe(false)
		expect(requirements.unresolvedShippingRefs).toEqual(['30406:seller:missing'])
	})
})

describe('isValidDigitalDeliveryContact', () => {
	test('accepts valid email contact for v1', () => {
		expect(isValidDigitalDeliveryContact('buyer@example.com')).toBe(true)
	})

	test('rejects empty or invalid contact', () => {
		expect(isValidDigitalDeliveryContact('')).toBe(false)
		expect(isValidDigitalDeliveryContact('not-an-email')).toBe(false)
	})
})
