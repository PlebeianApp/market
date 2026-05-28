import { beforeEach, describe, expect, mock, test } from 'bun:test'

let shippingServices: Record<string, string | null | undefined> = {}
const publishedEvents: Array<{ kind?: number; tags: string[][]; content: string }> = []

mock.module('@/queries/shipping', () => ({
	getShippingEvent: mock(async (shippingRef: string) => {
		if (!(shippingRef in shippingServices)) return null
		const service = shippingServices[shippingRef]
		return service ? { tags: [['service', service]] } : { tags: [] }
	}),
	getShippingService: (event: { tags: string[][] }) => event.tags.find((tag) => tag[0] === 'service'),
}))

mock.module('@/queries/profiles', () => ({
	fetchProfileByIdentifier: mock(async () => ({
		profile: {
			lud16: 'seller@example.com',
		},
	})),
}))

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		getNDK: () => ({
			activeUser: {
				pubkey: 'buyer-pubkey',
			},
		}),
		getSigner: () => ({}),
		publishEvent: mock(async (event: { kind?: number; tags: string[][]; content: string }) => {
			publishedEvents.push(event)
		}),
	},
}))

mock.module('@nostr-dev-kit/ndk', () => ({
	NDKEvent: class {
		kind?: number
		created_at?: number
		content = ''
		tags: string[][] = []
		id = ''

		constructor(_ndk?: unknown) {}

		async sign() {
			this.id = this.tags.find((tag) => tag[0] === 'order')?.[1] || `event-${publishedEvents.length + 1}`
		}
	},
}))

import { publishOrderWithDependencies } from '@/publish/orders'
import type { CheckoutFormData } from '@/components/checkout/ShippingAddressForm'

const baseShippingData: CheckoutFormData = {
	name: 'Satoshi Nakamoto',
	email: '',
	phone: '',
	firstLineOfAddress: '123 Main Street',
	zipPostcode: '90210',
	city: 'Los Angeles',
	country: 'United States',
	additionalInformation: '',
}

function paramsFor(overrides: {
	shippingData?: Partial<CheckoutFormData>
	productsBySeller: Record<string, Array<{ id: string; amount: number; shippingMethodId?: string | null }>>
	sellerData?: Record<string, { satsTotal: number; shippingSats: number; shares: { sellerAmount: number } }>
	sellers?: string[]
}) {
	const sellers = overrides.sellers || Object.keys(overrides.productsBySeller)
	const sellerData =
		overrides.sellerData ||
		Object.fromEntries(sellers.map((sellerPubkey) => [sellerPubkey, { satsTotal: 1000, shippingSats: 0, shares: { sellerAmount: 1000 } }]))

	return {
		shippingData: {
			...baseShippingData,
			...overrides.shippingData,
		},
		sellers,
		productsBySeller: overrides.productsBySeller,
		sellerData,
		v4vShares: {},
	}
}

function orderEvents() {
	return publishedEvents.filter((event) => event.kind === 16 && event.tags.some((tag) => tag[0] === 'type' && tag[1] === '1'))
}

describe('publishOrderWithDependencies delivery contact guard', () => {
	beforeEach(() => {
		shippingServices = {}
		publishedEvents.length = 0
	})

	test('rejects digital order without contact before publishing', async () => {
		shippingServices = {
			'30406:seller:digital': 'digital',
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					shippingData: { email: '' },
					productsBySeller: {
						seller: [{ id: 'digital-product', amount: 1, shippingMethodId: '30406:seller:digital' }],
					},
				}),
			),
		).rejects.toThrow('Digital delivery contact is required')

		expect(publishedEvents).toHaveLength(0)
	})

	test('rejects unresolved delivery requirements before publishing', async () => {
		shippingServices = {
			'30406:seller:missing-service': null,
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					shippingData: { email: 'buyer@example.com' },
					productsBySeller: {
						seller: [{ id: 'unknown-product', amount: 1, shippingMethodId: '30406:seller:missing-service' }],
					},
				}),
			),
		).rejects.toThrow('Delivery requirements could not be verified')

		expect(publishedEvents).toHaveLength(0)
	})

	test('preflights every seller group before publishing any order', async () => {
		shippingServices = {
			'30406:seller-a:standard': 'standard',
			'30406:seller-b:digital': 'digital',
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					shippingData: { email: '' },
					sellers: ['seller-a', 'seller-b'],
					productsBySeller: {
						'seller-a': [{ id: 'physical-product', amount: 1, shippingMethodId: '30406:seller-a:standard' }],
						'seller-b': [{ id: 'digital-product', amount: 1, shippingMethodId: '30406:seller-b:digital' }],
					},
				}),
			),
		).rejects.toThrow('Digital delivery contact is required')

		expect(publishedEvents).toHaveLength(0)
	})

	test('does not emit fake fallback contact when no email is provided', async () => {
		shippingServices = {
			'30406:seller:pickup': 'pickup',
		}

		await publishOrderWithDependencies(
			paramsFor({
				shippingData: { email: '' },
				productsBySeller: {
					seller: [{ id: 'pickup-product', amount: 1, shippingMethodId: '30406:seller:pickup' }],
				},
			}),
		)

		const order = orderEvents()[0]
		expect(order.tags.some((tag) => tag[0] === 'email')).toBe(false)
		expect(order.tags.some((tag) => tag.includes('customer@example.com'))).toBe(false)
		expect(order.tags.some((tag) => tag[0] === 'address')).toBe(false)
	})

	test('emits buyer-provided digital delivery contact and preserves physical address behavior', async () => {
		shippingServices = {
			'30406:seller:digital': 'digital',
			'30406:seller:standard': 'standard',
		}

		await publishOrderWithDependencies(
			paramsFor({
				shippingData: { email: 'buyer@example.com' },
				productsBySeller: {
					seller: [
						{ id: 'digital-product', amount: 1, shippingMethodId: '30406:seller:digital' },
						{ id: 'physical-product', amount: 1, shippingMethodId: '30406:seller:standard' },
					],
				},
			}),
		)

		const order = orderEvents()[0]
		expect(order.tags).toContainEqual(['email', 'buyer@example.com'])
		expect(order.tags.some((tag) => tag[0] === 'address' && tag[1].includes('123 Main Street'))).toBe(true)
	})
})

describe('getPublicSellerShippingRef edge cases (tested through createOrder)', () => {
	beforeEach(() => {
		shippingServices = {}
		publishedEvents.length = 0
	})

	test('rejects shipping ref with newline injection', async () => {
		await createOrder({
			productRef: '30402:seller:product',
			sellerPubkey: 'seller',
			quantity: 1,
			price: 1000,
			shippingRef: '30406:seller:pickup\naddress:buyer@evil.com',
			shippingAddress: 'leaked',
			email: 'leaked@example.com',
			phone: '+1555LEAK',
			notes: 'injected notes',
		})

		const order = orderEvents()[0]
		expect(order.tags.some((tag) => tag[0] === 'shipping')).toBe(false)
		expect(order.tags.some((tag) => tag[0] === 'address')).toBe(false)
		expect(order.tags.some((tag) => tag[0] === 'email')).toBe(false)
		expect(order.tags.some((tag) => tag[0] === 'phone')).toBe(false)
	})

	test('rejects shipping ref with carriage return injection', async () => {
		await createOrder({
			productRef: '30402:seller:product',
			sellerPubkey: 'seller',
			quantity: 1,
			price: 1000,
			shippingRef: '30406:seller:pickup\r\nemail:leaked@example.com',
			shippingAddress: 'leaked',
			email: 'leaked@example.com',
			phone: '+1555LEAK',
			notes: 'injected notes',
		})

		const order = orderEvents()[0]
		expect(order.tags.some((tag) => tag[0] === 'shipping')).toBe(false)
	})

	test('rejects non-30406 kind in shipping ref', async () => {
		await createOrder({
			productRef: '30402:seller:product',
			sellerPubkey: 'seller',
			quantity: 1,
			price: 1000,
			shippingRef: '30402:seller:product',
			shippingAddress: 'leaked',
			email: 'leaked@example.com',
			phone: '+1555LEAK',
			notes: 'leaked notes',
		})

		const order = orderEvents()[0]
		expect(order.tags.some((tag) => tag[0] === 'shipping' && tag[1] === '30402:seller:product')).toBe(false)
	})

	test('rejects shipping ref missing d-tag segment', async () => {
		await createOrder({
			productRef: '30402:seller:product',
			sellerPubkey: 'seller',
			quantity: 1,
			price: 1000,
			shippingRef: '30406:seller',
			shippingAddress: 'leaked',
			email: 'leaked@example.com',
			phone: '+1555LEAK',
			notes: 'leaked notes',
		})

		const order = orderEvents()[0]
		expect(order.tags.some((tag) => tag[0] === 'shipping')).toBe(false)
	})

	test('rejects empty shipping ref', async () => {
		await createOrder({
			productRef: '30402:seller:product',
			sellerPubkey: 'seller',
			quantity: 1,
			price: 1000,
			shippingRef: '',
			shippingAddress: 'leaked',
			email: 'leaked@example.com',
			phone: '+1555LEAK',
			notes: 'leaked notes',
		})

		const order = orderEvents()[0]
		expect(order.tags.some((tag) => tag[0] === 'shipping')).toBe(false)
	})

	test('accepts shipping ref with multi-colon d-tag', async () => {
		await createOrder({
			productRef: '30402:seller:product',
			sellerPubkey: 'seller',
			quantity: 1,
			price: 1000,
			shippingRef: '30406:seller:standard:us:insured',
			shippingAddress: 'leaked',
			email: 'leaked@example.com',
			phone: '+1555LEAK',
			notes: 'leaked notes',
		})

		const order = orderEvents()[0]
		expect(order.tags).toContainEqual(['shipping', '30406:seller:standard:us:insured'])
	})

	test('rejects whitespace-only shipping ref', async () => {
		await createOrder({
			productRef: '30402:seller:product',
			sellerPubkey: 'seller',
			quantity: 1,
			price: 1000,
			shippingRef: '   ',
			shippingAddress: 'leaked',
			email: 'leaked@example.com',
			phone: '+1555LEAK',
			notes: 'leaked notes',
		})

		const order = orderEvents()[0]
		expect(order.tags.some((tag) => tag[0] === 'shipping')).toBe(false)
	})
})

describe('requiresPrivateBuyerDeliveryDetails (tested through publishOrderWithDependencies)', () => {
	beforeEach(() => {
		shippingServices = {}
		publishedEvents.length = 0
	})

	test('multi-seller: pickup succeeds while physical fails closed', async () => {
		shippingServices = {
			'30406:seller-a:pickup': 'pickup',
			'30406:seller-b:standard': 'standard',
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					sellers: ['seller-a', 'seller-b'],
					productsBySeller: {
						'seller-a': [{ id: 'pickup-product', amount: 1, shippingMethodId: '30406:seller-a:pickup' }],
						'seller-b': [{ id: 'physical-product', amount: 1, shippingMethodId: '30406:seller-b:standard' }],
					},
				}),
			),
		).rejects.toThrow('Encrypted seller delivery is required before creating this order')

		expect(publishedEvents).toHaveLength(0)
	})

	test('multi-seller: all pickup orders publish successfully', async () => {
		shippingServices = {
			'30406:seller-a:pickup': 'pickup',
			'30406:seller-b:pickup': 'pickup',
		}

		await publishOrderWithDependencies(
			paramsFor({
				sellers: ['seller-a', 'seller-b'],
				productsBySeller: {
					'seller-a': [{ id: 'pickup-a', amount: 1, shippingMethodId: '30406:seller-a:pickup' }],
					'seller-b': [{ id: 'pickup-b', amount: 1, shippingMethodId: '30406:seller-b:pickup' }],
				},
			}),
		)

		expect(orderEvents()).toHaveLength(2)
		for (const order of orderEvents()) {
			expectPublicOrderEventsWithoutBuyerPii([order])
		}
	})
})

describe('createOrderCreationEvent content field privacy', () => {
	test('content does not contain buyer PII even when notes are provided', async () => {
		const order = await createOrderCreationEvent({
			merchantPubkey: 'seller',
			buyerPubkey: 'buyer-pubkey',
			orderItems: [{ productRef: '30402:seller:product', quantity: 1 }],
			totalAmountSats: 1000,
			shippingRef: '30406:seller:pickup',
			shippingAddress: baseShippingData,
			email: baseShippingData.email,
			phone: baseShippingData.phone,
			notes: 'Secret delivery instructions with buyer name Satoshi Nakamoto and email buyer@example.com',
		})

		expect(order.content).not.toContain('Satoshi')
		expect(order.content).not.toContain('buyer@example.com')
		expect(order.content).not.toContain('Secret')
		expect(order.content).toMatch(/^Order for \d+ item\(s\)$/)
	})

	test('content does not contain address from shippingAddress object', async () => {
		const order = await createOrderCreationEvent({
			merchantPubkey: 'seller',
			buyerPubkey: 'buyer-pubkey',
			orderItems: [{ productRef: '30402:seller:product', quantity: 2 }],
			totalAmountSats: 2000,
			shippingRef: '30406:seller:pickup',
			shippingAddress: baseShippingData,
			email: baseShippingData.email,
			phone: baseShippingData.phone,
			notes: 'Deliver to 123 Main Street',
		})

		expect(order.content).not.toContain('123 Main Street')
		expect(order.tags.some((tag) => tag[0] === 'address')).toBe(false)
	})
})
