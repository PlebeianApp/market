import { beforeEach, describe, expect, test } from 'bun:test'
import {
	normalizeProductShippingSelections,
	normalizePublishedProductShippingTags,
	resolveProductShippingSelections,
	resolvePublishedProductShippingOptions,
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

	test('published product shipping options resolve only attached refs in published order', () => {
		const publishedSelections = normalizePublishedProductShippingTags([
			['shipping_option', '30406:merchant:standard', '2'],
			['shipping_option', '30406:merchant:missing', '9'],
			['shipping_option', '30406:merchant:pickup', ''],
		])

		const resolvedOptions = resolvePublishedProductShippingOptions({
			publishedSelections,
			availableOptions: [
				{
					id: '30406:merchant:digital',
					name: 'Digital Delivery',
					cost: 0,
					currency: 'USD',
				},
				{
					id: '30406:merchant:pickup',
					name: 'Local Pickup',
					cost: 0,
					currency: 'USD',
				},
				{
					id: '30406:merchant:standard',
					name: 'Worldwide Standard',
					cost: 10,
					currency: 'USD',
				},
			],
		})

		expect(resolvedOptions).toEqual([
			{
				id: '30406:merchant:standard',
				name: 'Worldwide Standard',
				cost: 12,
				currency: 'USD',
				shippingRef: '30406:merchant:standard',
				baseCost: 10,
				extraCost: '2',
				extraCostAmount: 2,
				isResolved: true,
			},
			{
				id: '30406:merchant:pickup',
				name: 'Local Pickup',
				cost: 0,
				currency: 'USD',
				shippingRef: '30406:merchant:pickup',
				baseCost: 0,
				extraCost: '',
				extraCostAmount: 0,
				isResolved: true,
			},
		])
	})

	test('invalid or missing product extra cost resolves as zero while preserving final cost compatibility', () => {
		const resolvedOptions = resolvePublishedProductShippingOptions({
			publishedSelections: normalizePublishedProductShippingTags([
				['shipping_option', '30406:merchant:standard', 'not-a-number'],
				['shipping_option', '30406:merchant:pickup'],
			]),
			availableOptions: [
				{
					id: '30406:merchant:standard',
					name: 'Worldwide Standard',
					cost: 10,
					currency: 'USD',
				},
				{
					id: '30406:merchant:pickup',
					name: 'Local Pickup',
					cost: 0,
					currency: 'USD',
				},
			],
		})

		expect(resolvedOptions).toEqual([
			expect.objectContaining({
				id: '30406:merchant:standard',
				baseCost: 10,
				extraCost: 'not-a-number',
				extraCostAmount: 0,
				cost: 10,
			}),
			expect.objectContaining({
				id: '30406:merchant:pickup',
				baseCost: 0,
				extraCost: '',
				extraCostAmount: 0,
				cost: 0,
			}),
		])
	})
})
