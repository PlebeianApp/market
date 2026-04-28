import { describe, expect, test } from 'bun:test'
import {
	canonicalizeProductDeliveryService,
	productDeliveryModeAllowsProductExtraCost,
	productDeliveryModeRequiresShippingCost,
	productDeliveryModeUsesCoverage,
	resolveProductDeliveryMode,
	shippingServiceDisallowsProductExtraCost,
} from '@/lib/workflow/productDeliveryModes'

describe('product delivery modes', () => {
	test('maps pickup-like services to pickup mode', () => {
		expect(resolveProductDeliveryMode('pickup')).toBe('pickup')
		expect(resolveProductDeliveryMode('local-pickup')).toBe('pickup')
		expect(resolveProductDeliveryMode('Local Pickup')).toBe('pickup')
		expect(resolveProductDeliveryMode({ service: 'store_collection' })).toBe('pickup')
	})

	test('maps digital-like services to digital mode', () => {
		expect(resolveProductDeliveryMode('digital')).toBe('digital')
		expect(resolveProductDeliveryMode('digital-delivery')).toBe('digital')
		expect(resolveProductDeliveryMode('instant_download')).toBe('digital')
		expect(resolveProductDeliveryMode({ service: 'virtual delivery' })).toBe('digital')
	})

	test('maps physical shipping services to physical mode', () => {
		expect(resolveProductDeliveryMode('standard')).toBe('physical')
		expect(resolveProductDeliveryMode('express')).toBe('physical')
		expect(resolveProductDeliveryMode('overnight')).toBe('physical')
		expect(resolveProductDeliveryMode('worldwide-standard')).toBe('physical')
		expect(resolveProductDeliveryMode(undefined)).toBe('physical')
	})

	test('only physical mode exposes product-specific extra-cost semantics', () => {
		expect(productDeliveryModeAllowsProductExtraCost('pickup')).toBe(false)
		expect(productDeliveryModeAllowsProductExtraCost('digital')).toBe(false)
		expect(productDeliveryModeAllowsProductExtraCost('physical')).toBe(true)
		expect(shippingServiceDisallowsProductExtraCost('pickup')).toBe(true)
		expect(shippingServiceDisallowsProductExtraCost('digital')).toBe(true)
		expect(shippingServiceDisallowsProductExtraCost('standard')).toBe(false)
	})

	test('only physical mode uses shipping-cost and coverage controls', () => {
		expect(productDeliveryModeRequiresShippingCost('pickup')).toBe(false)
		expect(productDeliveryModeRequiresShippingCost('digital')).toBe(false)
		expect(productDeliveryModeRequiresShippingCost('physical')).toBe(true)
		expect(productDeliveryModeUsesCoverage('pickup')).toBe(false)
		expect(productDeliveryModeUsesCoverage('digital')).toBe(false)
		expect(productDeliveryModeUsesCoverage('physical')).toBe(true)
	})

	test('canonicalizes pickup aliases before persistence', () => {
		expect(canonicalizeProductDeliveryService('local-pickup')).toBe('pickup')
		expect(canonicalizeProductDeliveryService('store_collection')).toBe('pickup')
	})

	test('canonicalizes digital aliases before persistence', () => {
		expect(canonicalizeProductDeliveryService('digital-delivery')).toBe('digital')
		expect(canonicalizeProductDeliveryService('instant_download')).toBe('digital')
	})

	test('canonicalizes physical aliases before persistence', () => {
		expect(canonicalizeProductDeliveryService('express-shipping')).toBe('express')
		expect(canonicalizeProductDeliveryService('overnight-delivery')).toBe('overnight')
		expect(canonicalizeProductDeliveryService('worldwide-standard')).toBe('standard')
		expect(canonicalizeProductDeliveryService('carrier-rate')).toBe('standard')
	})
})
