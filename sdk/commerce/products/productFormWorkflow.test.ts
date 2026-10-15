import { describe, expect, test } from 'bun:test'
import {
	getAdjacentSellerProductTab,
	getFirstBlockingSellerProductTab,
	getSellerProductFormValidationIssues,
	getSellerProductTabValidationIssues,
	SELLER_PRODUCT_FORM_TAB_ORDER,
} from './productFormWorkflow'

const validForm = {
	name: 'Coat',
	description: 'A warm coat',
	price: '1000',
	fiatPrice: '',
	currency: 'SATS',
	currencyMode: 'sats' as const,
	bitcoinUnit: 'SATS' as const,
	quantity: '2',
	mainCategory: 'clothing',
	images: ['image'],
	shippings: [{ shippingRef: '30406:merchant:shipping', extraCost: '' }],
}

describe('seller product form workflow', () => {
	test('tab order and adjacent navigation match the current form tabs', () => {
		expect(SELLER_PRODUCT_FORM_TAB_ORDER).toEqual(['name', 'detail', 'spec', 'category', 'images', 'shipping'])
		expect(getAdjacentSellerProductTab('name', 'previous')).toBeNull()
		expect(getAdjacentSellerProductTab('name', 'next')).toBe('detail')
		expect(getAdjacentSellerProductTab('shipping', 'next')).toBeNull()
	})

	test('valid form has no blocking issues', () => {
		expect(getSellerProductFormValidationIssues(validForm)).toEqual([])
		expect(getFirstBlockingSellerProductTab(validForm, 'shipping')).toBeNull()
	})

	test('validates required seller fields per tab and returns existing messages', () => {
		const invalid = {
			...validForm,
			name: '  ',
			description: '',
			price: '',
			quantity: 'many',
			mainCategory: '',
			images: [],
			shippings: [],
		}
		expect(getSellerProductTabValidationIssues(invalid, 'name')).toEqual(['Product name is required', 'Description is required'])
		expect(getSellerProductTabValidationIssues(invalid, 'detail')).toEqual([
			'Valid product price is required',
			'Valid product quantity is required',
		])
		expect(getSellerProductTabValidationIssues(invalid, 'category')).toEqual(['Main category is required'])
		expect(getSellerProductTabValidationIssues(invalid, 'images')).toEqual(['At least one image is required'])
		expect(getSellerProductTabValidationIssues(invalid, 'shipping')).toEqual(['At least one shipping option is required'])
		expect(getSellerProductTabValidationIssues(invalid, 'spec')).toEqual([])
	})

	test('blocks forward navigation on the first earlier tab with issues but allows backward navigation', () => {
		const invalid = { ...validForm, description: '' }
		expect(getFirstBlockingSellerProductTab(invalid, 'images')).toBe('name')
		expect(getFirstBlockingSellerProductTab(invalid, 'name')).toBeNull()
	})
})
