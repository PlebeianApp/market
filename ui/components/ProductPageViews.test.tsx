import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdultContentGate, ProductNotFoundState, ProductPurchasePanel, type ProductPurchasePanelProps } from './ProductPageViews'

const base: ProductPurchasePanelProps = {
	visibility: 'on-sale',
	stock: 3,
	productType: { product: 'simple', delivery: 'shipping' },
	quantity: 1,
	onQuantityChange: () => {},
	isOutOfStock: false,
	canAddToCart: true,
	canEdit: false,
	onAddToCart: () => {},
	onEdit: () => {},
}

describe('product page views', () => {
	test('purchase panel renders stock, type, notice, and add-to-cart for buyers', () => {
		const markup = renderToStaticMarkup(<ProductPurchasePanel {...base} notice={<em>curated</em>} />)
		expect(markup).toContain('3 in stock')
		expect(markup).toContain('Simple / Shipping')
		expect(markup).toContain('<em>curated</em>')
		expect(markup).toContain('Add to cart')
		expect(markup).not.toContain('Edit Product')
	})

	test('labels reflect visibility and stock without hiding the control', () => {
		expect(renderToStaticMarkup(<ProductPurchasePanel {...base} visibility="pre-order" />)).toContain('Pre-order')
		expect(renderToStaticMarkup(<ProductPurchasePanel {...base} visibility="hidden" />)).toContain('Not Available')
		expect(renderToStaticMarkup(<ProductPurchasePanel {...base} isOutOfStock />)).toContain('Out of Stock')
	})

	test('owners see edit instead of cart controls; no controls without stock data', () => {
		const owner = renderToStaticMarkup(<ProductPurchasePanel {...base} canAddToCart={false} canEdit />)
		expect(owner).toContain('Edit Product')
		expect(owner).not.toContain('Add to cart')
		expect(renderToStaticMarkup(<ProductPurchasePanel {...base} stock={undefined} />)).not.toContain('Add to cart')
	})

	test('status states link back to the product list through the host link', () => {
		expect(renderToStaticMarkup(<ProductNotFoundState />)).toContain('href="/products"')
		expect(renderToStaticMarkup(<AdultContentGate onEnable={() => {}} />)).toContain('Enable adult content')
	})
})
