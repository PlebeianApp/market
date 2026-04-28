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

	test('stale product-specific extra cost is stripped from digital selections', () => {
		expect(
			normalizeProductShippingSelections([
				{
					shippingRef: '30406:merchant:digital',
					service: 'digital',
					extraCost: '12.50',
				},
			]),
		).toEqual([
			{
				shippingRef: '30406:merchant:digital',
				service: 'digital',
				extraCost: '',
			},
		])
	})

	test('stale product-specific extra cost is stripped from pickup selections', () => {
		expect(
			normalizeProductShippingSelections([
				{
					shippingRef: '30406:merchant:pickup',
					service: 'pickup',
					extraCost: '7',
				},
			]),
		).toEqual([
			{
				shippingRef: '30406:merchant:pickup',
				service: 'pickup',
				extraCost: '',
			},
		])
	})

	test('physical shipping extra cost is preserved and normalized', () => {
		expect(
			normalizeProductShippingSelections([
				{
					shippingRef: '30406:merchant:standard',
					service: 'standard',
					extraCost: '4.567',
				},
			]),
		).toEqual([
			{
				shippingRef: '30406:merchant:standard',
				service: 'standard',
				extraCost: '4.56',
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

	test('resolved digital and pickup services strip stale extra cost', () => {
		const resolvedSelections = resolveProductShippingSelections(
			[
				{
					shippingRef: '30406:merchant:digital',
					extraCost: '9.99',
				},
				{
					shippingRef: '30406:merchant:pickup',
					extraCost: '3',
				},
				{
					shippingRef: '30406:merchant:standard',
					extraCost: '2.125',
				},
			],
			[
				{ id: '30406:merchant:digital', service: 'digital' },
				{ id: '30406:merchant:pickup', service: 'pickup' },
				{ id: '30406:merchant:standard', service: 'standard' },
			],
		)

		expect(resolvedSelections.map(({ shippingRef, extraCost, service }) => ({ shippingRef, extraCost, service }))).toEqual([
			{ shippingRef: '30406:merchant:digital', extraCost: '', service: 'digital' },
			{ shippingRef: '30406:merchant:pickup', extraCost: '', service: 'pickup' },
			{ shippingRef: '30406:merchant:standard', extraCost: '2.12', service: 'standard' },
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
