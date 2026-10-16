import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	ProductCategoryView,
	ProductPricingView,
	ProductShippingView,
	ProductSpecsView,
	validateProductQuantity,
} from './ProductEditorTabs'

const noop = () => {}

const pricing = {
	currencies: ['SATS', 'USD'],
	currency: 'USD',
	onCurrencyChange: noop,
	fiatDisplayValue: '25.00',
	onFiatPriceChange: noop,
	bitcoinUnit: 'SATS' as const,
	bitcoinDisplayValue: '25000',
	onBitcoinPriceChange: noop,
	onToggleBitcoinUnit: noop,
	currencyMode: 'fiat' as const,
	onCurrencyModeChange: noop,
	quantity: '3',
	onQuantityChange: noop,
	status: 'on-sale' as const,
	onStatusChange: noop,
	isNSFW: false,
	onNSFWChange: noop,
}

const shipping = {
	selected: [],
	available: [],
	hasValidShipping: false,
	isLoading: false,
	isFetched: true,
	onExtraCostChange: noop,
	onRemove: noop,
	onAdd: noop,
	templates: [{ name: 'Digital Delivery', description: 'Instant', icon: 'digital' as const }],
	onQuickCreate: noop,
	isCreating: false,
	showPickupForm: false,
	pickupAddress: { street: '', city: '', state: '', postalCode: '', country: '' },
	onPickupAddressChange: noop,
	onPickupCancel: noop,
	onPickupSubmit: noop,
}

describe('ProductPricingView', () => {
	test('shows the fiat field and currency mode for fiat currencies', () => {
		const markup = renderToStaticMarkup(createElement(ProductPricingView, pricing))
		expect(markup).toContain('id="fiat-price"')
		expect(markup).toContain('Currency Mode')
		expect(markup).toContain('data-testid="product-quantity-input"')
	})

	test('hides the fiat field for bitcoin currencies', () => {
		const markup = renderToStaticMarkup(createElement(ProductPricingView, { ...pricing, currency: 'SATS' }))
		expect(markup).not.toContain('id="fiat-price"')
		expect(markup).not.toContain('Currency Mode')
	})

	test('quantity validation', () => {
		expect(validateProductQuantity('')).toBe('Quantity is required')
		expect(validateProductQuantity('1a')).toBe('Please enter a valid number')
		expect(validateProductQuantity('12')).toBeUndefined()
	})
})

describe('ProductCategoryView', () => {
	test('sub categories appear once a main category is chosen', () => {
		const props = {
			mainCategories: ['Bitcoin'],
			onMainCategoryChange: noop,
			subCategories: [{ key: 'a', name: 'Miners' }],
			onSubCategoryNameChange: noop,
			onRemoveSubCategory: noop,
			onAddSubCategory: noop,
		}
		expect(renderToStaticMarkup(createElement(ProductCategoryView, { ...props, mainCategory: '' }))).not.toContain('Sub Category 1')
		expect(renderToStaticMarkup(createElement(ProductCategoryView, { ...props, mainCategory: 'Bitcoin' }))).toContain('Miners')
	})
})

describe('ProductShippingView', () => {
	test('offers quick-create templates when no options exist', () => {
		const markup = renderToStaticMarkup(createElement(ProductShippingView, shipping))
		expect(markup).toContain('At least one shipping option required')
		expect(markup).toContain('Digital Delivery')
	})

	test('flags selected references that no longer resolve', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductShippingView, {
				...shipping,
				hasValidShipping: true,
				selected: [{ shippingRef: '30406:me:gone', extraCost: '', option: null }],
			}),
		)
		expect(markup).toContain('This shipping reference is no longer available: 30406:me:gone')
	})

	test('shows the pickup address form', () => {
		const markup = renderToStaticMarkup(createElement(ProductShippingView, { ...shipping, showPickupForm: true }))
		expect(markup).toContain('id="pickup-street"')
		expect(markup).toContain('id="pickup-country"')
	})
})

describe('ProductSpecsView', () => {
	test('renders each spec row', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductSpecsView, {
				specs: [{ key: 'Material', value: 'Cotton' }],
				onSpecChange: noop,
				onAddSpec: noop,
				onRemoveSpec: noop,
			}),
		)
		expect(markup).toContain('Material')
		expect(markup).toContain('Cotton')
	})
})
