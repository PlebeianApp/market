import { beforeEach, describe, expect, test } from 'bun:test'
import {
	findReusablePublishedShippingSelection,
	formatShippingCostForInput,
	formatShippingDisplayText,
	getProductShippingExtraCostFromTotal,
	getProductShippingTotalCost,
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

describe('shipping cost helpers', () => {
	test('calculates total cost from a base cost and extra cost string', () => {
		expect(getProductShippingTotalCost(10, '2.5')).toBe(12.5)
		expect(getProductShippingTotalCost(undefined, '5')).toBe(5)
	})

	test('derives extra cost from a total cost value', () => {
		expect(getProductShippingExtraCostFromTotal(10, '12.5')).toBe('2.5')
		expect(getProductShippingExtraCostFromTotal(10, '10')).toBe('')
		expect(getProductShippingExtraCostFromTotal(10, 'not-a-number')).toBe('')
	})

	test('formats shipping cost values for numeric inputs', () => {
		expect(formatShippingCostForInput('2.345')).toBe('2.35')
		expect(formatShippingCostForInput(10)).toBe('10')
		expect(formatShippingCostForInput('')).toBe('')
	})

	test('formats shipping display text from the resolved shipping option', () => {
		expect(
			formatShippingDisplayText('30406:merchant:standard', { title: 'Standard Shipping', price: { amount: 5, currency: 'USD' } } as any),
		).toBe('Standard Shipping • 5 USD')
	})
})

describe('findReusablePublishedShippingSelection', () => {
	const sellerPubkey = 'seller-a'
	const reusableShippingRef = '30406:seller-a:standard'
	const reusableProduct = {
		id: 'existing-product',
		sellerPubkey,
		shippingMethodId: reusableShippingRef,
	}
	const resolvedShippingOption = {
		id: reusableShippingRef,
		shippingRef: reusableShippingRef,
		name: 'Standard Shipping',
		cost: 25,
		currency: 'USD',
	}

	test('inherits same-seller shipping when the new product resolves the selected ref', () => {
		expect(
			findReusablePublishedShippingSelection({
				currentProductId: 'new-product',
				sellerPubkey,
				products: [reusableProduct],
				resolvedShippingOptions: [resolvedShippingOption],
			}),
		).toEqual({
			shippingMethodId: reusableShippingRef,
			shippingMethodName: 'Standard Shipping',
			shippingCost: 25,
			shippingCostCurrency: 'USD',
		})
	})

	test('inherits the method but uses the new product resolved cost for a different product extra cost', () => {
		const productWithOldStoredCost = {
			...reusableProduct,
			shippingMethodName: 'Old Product Shipping',
			shippingCost: 40,
			shippingCostCurrency: 'USD',
		}

		expect(
			findReusablePublishedShippingSelection({
				currentProductId: 'new-product',
				sellerPubkey,
				products: [productWithOldStoredCost],
				resolvedShippingOptions: [{ ...resolvedShippingOption, cost: 30 }],
			}),
		).toEqual({
			shippingMethodId: reusableShippingRef,
			shippingMethodName: 'Standard Shipping',
			shippingCost: 30,
			shippingCostCurrency: 'USD',
		})
	})

	test('does not inherit when the selected ref is not resolved for the new product', () => {
		expect(
			findReusablePublishedShippingSelection({
				currentProductId: 'new-product',
				sellerPubkey,
				products: [reusableProduct],
				resolvedShippingOptions: [{ ...resolvedShippingOption, id: '30406:seller-a:pickup', shippingRef: '30406:seller-a:pickup' }],
			}),
		).toBeNull()
	})

	test('does not inherit from a different seller', () => {
		expect(
			findReusablePublishedShippingSelection({
				currentProductId: 'new-product',
				sellerPubkey,
				products: [{ ...reusableProduct, sellerPubkey: 'seller-b' }],
				resolvedShippingOptions: [resolvedShippingOption],
			}),
		).toBeNull()
	})

	test('does not inherit incomplete selected shipping ref state', () => {
		expect(
			findReusablePublishedShippingSelection({
				currentProductId: 'new-product',
				sellerPubkey,
				products: [{ ...reusableProduct, shippingMethodId: null }],
				resolvedShippingOptions: [resolvedShippingOption],
			}),
		).toBeNull()
	})

	test('does not inherit when no matching option is resolved for the new product', () => {
		expect(
			findReusablePublishedShippingSelection({
				currentProductId: 'new-product',
				sellerPubkey,
				products: [reusableProduct],
				resolvedShippingOptions: [],
			}),
		).toBeNull()
	})

	test('uses the new resolved option name, cost, and currency instead of old cart product values', () => {
		const productWithOldStoredValues = {
			...reusableProduct,
			shippingMethodName: 'Old Product Shipping',
			shippingCost: 999,
			shippingCostCurrency: 'OLD',
		}

		const selection = findReusablePublishedShippingSelection({
			currentProductId: 'new-product',
			sellerPubkey,
			products: [productWithOldStoredValues],
			resolvedShippingOptions: [{ ...resolvedShippingOption, name: 'New Product Shipping', cost: 5, currency: 'SATS' }],
		})

		expect(selection).toEqual({
			shippingMethodId: reusableShippingRef,
			shippingMethodName: 'New Product Shipping',
			shippingCost: 5,
			shippingCostCurrency: 'SATS',
		})
	})
})
