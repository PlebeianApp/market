import { describe, expect, test } from 'bun:test'
import { createProductEvent, type ProductFormData } from '@/publish/products'
import { productFormTypeFromTag, productTypeTag } from '@/lib/utils/productType'

const BASE_FORM_DATA: ProductFormData = {
	name: 'Product',
	summary: 'Summary',
	description: 'Description',
	price: '1000',
	quantity: '1',
	currency: 'SATS',
	status: 'on-sale',
	productType: 'single',
	mainCategory: 'Bitcoin',
	selectedCollection: null,
	categories: [],
	images: [{ imageUrl: 'https://example.com/product.png', imageOrder: 0 }],
	specs: [],
	shippings: [],
	weight: null,
	dimensions: null,
	isNSFW: false,
}

const typeTagOf = (formData: ProductFormData) => createProductEvent(formData, {} as any, {} as any).tags.find((tag) => tag[0] === 'type')

describe('productFormTypeFromTag', () => {
	test('a listing without a type tag loads as a single physical product', () => {
		expect(productFormTypeFromTag(undefined)).toEqual({ productType: 'single', format: 'physical' })
	})

	test('simple and variable tags keep their type', () => {
		expect(productFormTypeFromTag(['type', 'simple', 'physical']).productType).toBe('single')
		expect(productFormTypeFromTag(['type', 'variable', 'physical']).productType).toBe('variable')
	})

	test('unknown or malformed type values load as single', () => {
		expect(productFormTypeFromTag(['type', '', 'physical']).productType).toBe('single')
		expect(productFormTypeFromTag(['type']).productType).toBe('single')
		expect(productFormTypeFromTag(['type', 'Variable', 'physical']).productType).toBe('single')
	})

	test('keeps the digital format', () => {
		expect(productFormTypeFromTag(['type', 'simple', 'digital']).format).toBe('digital')
	})
})

describe('productTypeTag', () => {
	test('publishes variable only for an exact variable value', () => {
		expect(productTypeTag('variable', 'physical')).toEqual(['type', 'variable', 'physical'])
		expect(productTypeTag('single', 'physical')).toEqual(['type', 'simple', 'physical'])
		expect(productTypeTag('', 'physical')).toEqual(['type', 'simple', 'physical'])
		expect(productTypeTag(undefined, undefined)).toEqual(['type', 'simple', 'physical'])
	})
})

describe('createProductEvent type tag', () => {
	test('a single product publishes as simple physical', () => {
		expect(typeTagOf(BASE_FORM_DATA)).toEqual(['type', 'simple', 'physical'])
	})

	test('an empty product type publishes as simple, not variable', () => {
		// Regression: the disabled Product Type select could write "" into the form,
		// and anything other than 'single' used to publish as variable.
		expect(typeTagOf({ ...BASE_FORM_DATA, productType: '' as any })).toEqual(['type', 'simple', 'physical'])
	})

	test('an explicit variable product still publishes as variable', () => {
		expect(typeTagOf({ ...BASE_FORM_DATA, productType: 'variable' })).toEqual(['type', 'variable', 'physical'])
	})

	test('a digital product stays digital', () => {
		expect(typeTagOf({ ...BASE_FORM_DATA, format: 'digital' })).toEqual(['type', 'simple', 'digital'])
	})
})
