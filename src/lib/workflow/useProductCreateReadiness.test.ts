import { describe, expect, test } from 'bun:test'
import { getRemainingQuickTemplateServices, normalizeQuickShippingTemplateService } from '@/lib/workflow/useProductCreateReadiness'

describe('product create readiness helpers', () => {
	test('normalizes quick template services by service key', () => {
		expect(normalizeQuickShippingTemplateService(' STANDARD ')).toBe('standard')
		expect(normalizeQuickShippingTemplateService('pickup')).toBe('pickup')
		expect(normalizeQuickShippingTemplateService('Digital Delivery')).toBeNull()
		expect(normalizeQuickShippingTemplateService('express')).toBeNull()
	})

	test('derives remaining quick templates from normalized saved services', () => {
		expect(getRemainingQuickTemplateServices([])).toEqual(['digital', 'standard', 'pickup'])
		expect(getRemainingQuickTemplateServices(['standard'])).toEqual(['digital', 'pickup'])
		expect(getRemainingQuickTemplateServices(['standard', 'pickup'])).toEqual(['digital'])
		expect(getRemainingQuickTemplateServices(['standard', 'pickup', 'digital'])).toEqual([])
	})
})
