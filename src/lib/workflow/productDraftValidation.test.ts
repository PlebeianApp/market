import { describe, expect, test } from 'bun:test'
import { DEFAULT_FORM_STATE, type ProductFormState } from '@/lib/stores/product'
import { validateProductDraft, validateProductPublishDraft } from '@/lib/workflow/productDraftValidation'

const makeState = (overrides: Partial<ProductFormState> = {}): ProductFormState => ({
	...DEFAULT_FORM_STATE,
	...overrides,
})

describe('validateProductDraft', () => {
	test('returns deterministic issues and first incomplete tab for empty drafts', () => {
		const validation = validateProductDraft({
			state: makeState(),
			resolvedShippingRefs: new Set(),
			isShippingFetched: true,
		})

		expect(validation.issues).toEqual([
			'Product name is required',
			'Product description is required',
			'Valid product price is required',
			'Valid product quantity is required',
			'Main category is required',
			'At least one product image is required',
			'At least one shipping option is required',
		])
		expect(validation.issuesByTab).toEqual({
			name: ['Product name is required', 'Product description is required'],
			detail: ['Valid product price is required', 'Valid product quantity is required'],
			category: ['Main category is required'],
			images: ['At least one product image is required'],
			shipping: ['At least one shipping option is required'],
		})
		expect(validation.firstIncompleteTab).toBe('name')
		expect(validation.allRequiredFieldsValid).toBe(false)
	})

	test('marks required fields valid when the selected shipping ref resolves', () => {
		const validation = validateProductDraft({
			state: makeState({
				name: 'Valid product',
				description: 'Valid description',
				price: '1000',
				quantity: '1',
				mainCategory: 'Bitcoin',
				images: [{ imageUrl: 'https://example.com/image.png', imageOrder: 0 }],
				shippings: [{ shippingRef: 'seller-pubkey:standard', extraCost: '100' }],
			}),
			resolvedShippingRefs: new Set(['seller-pubkey:standard']),
			isShippingFetched: true,
		})

		expect(validation.hasValidName).toBe(true)
		expect(validation.hasValidDescription).toBe(true)
		expect(validation.hasValidCategory).toBe(true)
		expect(validation.hasValidImages).toBe(true)
		expect(validation.hasValidShipping).toBe(true)
		expect(validation.issues).toEqual([])
		expect(validation.allRequiredFieldsValid).toBe(true)
		expect(validation.firstIncompleteTab).toBe('shipping')
	})

	test('keeps current shipping readiness semantics before and after seller shipping fetch', () => {
		const state = makeState({
			name: 'Valid product',
			description: 'Valid description',
			price: '1000',
			quantity: '1',
			mainCategory: 'Bitcoin',
			images: [{ imageUrl: 'https://example.com/image.png', imageOrder: 0 }],
			shippings: [{ shippingRef: 'seller-pubkey:standard', extraCost: '' }],
		})

		expect(
			validateProductDraft({
				state,
				resolvedShippingRefs: new Set(),
				isShippingFetched: false,
			}).hasValidShipping,
		).toBe(true)

		expect(
			validateProductDraft({
				state,
				resolvedShippingRefs: new Set(),
				isShippingFetched: true,
			}).hasValidShipping,
		).toBe(false)

		expect(
			validateProductDraft({
				state,
				resolvedShippingRefs: new Set(['seller-pubkey:standard']),
				isShippingFetched: true,
			}).allRequiredFieldsValid,
		).toBe(true)
	})

	test('canonical publish validation rejects missing price and category', () => {
		const validation = validateProductPublishDraft({
			name: 'Valid product',
			description: 'Valid description',
			price: '',
			quantity: '1',
			mainCategory: null,
			images: [{ imageUrl: 'https://example.com/image.png', imageOrder: 0 }],
			shippings: [{ shippingRef: 'seller-pubkey:standard', extraCost: '' }],
		})

		expect(validation.isValid).toBe(false)
		expect(validation.issues).toContain('Valid product price is required')
		expect(validation.issues).toContain('Main category is required')
	})
})
