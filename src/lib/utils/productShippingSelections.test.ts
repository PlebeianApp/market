import { beforeEach, describe, expect, test } from 'bun:test'
import {
	normalizeProductShippingExtraCost,
	normalizeProductShippingSelections,
	resolveProductShippingSelections,
	sanitizeProductShippingExtraCostInput,
} from '@/lib/utils/productShippingSelections'
import { DEFAULT_FORM_STATE, productFormActions, productFormStore } from '@/lib/stores/product'

describe('product shipping selection normalization', () => {
	beforeEach(() => {
		productFormStore.setState(() => DEFAULT_FORM_STATE)
	})

	test('legacy draft/input shape normalizes into canonical shipping refs at the boundary', () => {
		productFormActions.updateValues({
			shippings: [
				{
					shipping: {
						id: '30406:merchant:standard',
						name: 'Standard Shipping',
					},
					extraCost: '5',
				},
			] as any,
		})

		expect(productFormStore.state.shippings).toEqual([
			{
				shippingRef: '30406:merchant:standard',
				extraCost: '5',
			},
		])
	})

	test('canonical selections stay canonical after normalization', () => {
		expect(
			normalizeProductShippingSelections([
				{
					shippingRef: '30406:merchant:pickup',
					extraCost: '0',
				},
			]),
		).toEqual([
			{
				shippingRef: '30406:merchant:pickup',
				extraCost: '0',
			},
		])
	})

	test('unresolved shipping refs are surfaced as unavailable', () => {
		const resolvedSelections = resolveProductShippingSelections(
			[
				{
					shippingRef: '30406:merchant:missing',
					extraCost: '2',
				},
			],
			[],
		)

		expect(resolvedSelections).toEqual([
			{
				shippingRef: '30406:merchant:missing',
				extraCost: '2',
				option: null,
				isResolved: false,
			},
		])
	})

	test('shipping extra cost normalization rejects garbage and dashed strings', () => {
		expect(normalizeProductShippingExtraCost('15.213123-212-1')).toBe('')
		expect(normalizeProductShippingExtraCost('-1')).toBe('')
		expect(normalizeProductShippingExtraCost('abc')).toBe('')
	})

	test('shipping extra cost input keeps non-negative two-decimal precision', () => {
		expect(sanitizeProductShippingExtraCostInput('15.213')).toBe('15.21')
		expect(sanitizeProductShippingExtraCostInput('15.2')).toBe('15.2')
		expect(sanitizeProductShippingExtraCostInput('0')).toBe('0')
		expect(sanitizeProductShippingExtraCostInput('15-2')).toBeNull()
	})
})
