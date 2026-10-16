import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShippingOptionsEmptyState, ShippingOptionsMobileToolbar, ShippingOptionsToolbar } from './ShippingOptionsViews'

const serviceTypes = [
	{ value: 'standard', label: 'Standard' },
	{ value: 'pickup', label: 'Local Pickup' },
]

describe('shipping options views', () => {
	test('toolbars expose add actions', () => {
		const props = { serviceFilter: 'all', onServiceFilterChange: () => {}, serviceTypes, onAdd: () => {} }
		expect(renderToStaticMarkup(<ShippingOptionsToolbar {...props} />)).toContain('Add Shipping Option')
		expect(renderToStaticMarkup(<ShippingOptionsMobileToolbar {...props} />)).toContain('Manage your shipping options')
	})

	test('empty state names the filtered service', () => {
		expect(renderToStaticMarkup(<ShippingOptionsEmptyState serviceFilter="all" serviceTypes={serviceTypes} />)).toContain(
			'No shipping options configured yet',
		)
		expect(renderToStaticMarkup(<ShippingOptionsEmptyState serviceFilter="pickup" serviceTypes={serviceTypes} />)).toContain(
			'No local pickup shipping options found.',
		)
	})
})
