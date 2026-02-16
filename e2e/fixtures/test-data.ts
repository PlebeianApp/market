/**
 * Test data fixtures for e2e tests.
 * Provides reusable product data, shipping addresses, and order expectations.
 */

export const TEST_PRODUCTS = {
	basic: {
		name: 'Test Widget',
		description: 'A simple test product for e2e testing.',
		price: '10000',
		quantity: '25',
		status: 'on-sale',
		mainCategory: 'Bitcoin',
		imageUrl: 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
	},
	expensive: {
		name: 'Premium Test Item',
		description: 'An expensive test product.',
		price: '500000',
		quantity: '5',
		status: 'on-sale',
		mainCategory: 'Bitcoin',
		imageUrl: 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
	},
	outOfStock: {
		name: 'Sold Out Item',
		description: 'This product has no stock.',
		price: '5000',
		quantity: '0',
		status: 'on-sale',
		mainCategory: 'Art',
		imageUrl: 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
	},
	preOrder: {
		name: 'Upcoming Release',
		description: 'Available for pre-order.',
		price: '75000',
		quantity: '100',
		status: 'pre-order',
		mainCategory: 'Clothing',
		imageUrl: 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
	},
} as const

export const TEST_SHIPPING_ADDRESSES = {
	domestic: {
		name: 'Test Buyer',
		email: 'buyer@example.com',
		phone: '+1234567890',
		address: '123 Test Street',
		zip: '10001',
		city: 'New York',
		country: 'US',
	},
	international: {
		name: 'International Buyer',
		email: 'intl@example.com',
		phone: '+4412345678',
		address: '10 Downing Street',
		zip: 'SW1A 2AA',
		city: 'London',
		country: 'GB',
	},
	minimal: {
		name: 'Min Buyer',
		email: 'min@example.com',
		address: '1 Main St',
		zip: '90210',
	},
} as const

export const ORDER_STATUSES = [
	'PENDING',
	'PAYMENT_REQUESTED',
	'PAYMENT_RECEIVED',
	'CONFIRMED',
	'PROCESSING',
	'SHIPPED',
	'COMPLETED',
	'CANCELLED',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]
