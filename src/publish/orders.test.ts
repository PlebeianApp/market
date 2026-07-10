import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, getEventHash, getPublicKey, nip44 } from 'nostr-tools'
import type { Event, UnsignedEvent } from 'nostr-tools'

type PublishedEvent = {
	kind?: number
	created_at?: number
	content: string
	tags: string[][]
	id?: string
	pubkey?: string
	sig?: string
	rawEvent?: () => Event
}

type TestKeyPair = {
	privateKey: Uint8Array
	pubkey: string
}

type TestSignerOptions = {
	supportsNip44?: boolean
	canEncrypt?: boolean
	signThrows?: boolean
	pubkeyOverride?: string
}

let shippingServices: Record<string, string | null | undefined> = {}
let currentBuyer: TestKeyPair
let currentSigner: TestSigner | undefined
const publishedEvents: PublishedEvent[] = []
const publishResults: unknown[] = []

class TestNDKUser {
	pubkey: string

	constructor(params: { pubkey: string }) {
		this.pubkey = params.pubkey
	}
}

type TestSigner = {
	user: () => Promise<TestNDKUser>
	encryptionEnabled: (scheme?: 'nip04' | 'nip44') => Promise<Array<'nip04' | 'nip44'>>
	encrypt: (recipient: TestNDKUser, plaintext: string, scheme?: 'nip04' | 'nip44') => Promise<string>
	decrypt: (sender: TestNDKUser, ciphertext: string, scheme?: 'nip04' | 'nip44') => Promise<string>
	sign: (event: UnsignedEvent & { pubkey: string }) => Promise<string>
}

function createKeyPair(): TestKeyPair {
	const privateKey = crypto.getRandomValues(new Uint8Array(32))
	return {
		privateKey,
		pubkey: getPublicKey(privateKey),
	}
}

function createSigner(privateKey: Uint8Array, options: TestSignerOptions = {}): TestSigner {
	const signerPubkey = options.pubkeyOverride ?? getPublicKey(privateKey)
	const signerUser = new TestNDKUser({ pubkey: signerPubkey })

	return {
		user: async () => signerUser,
		encryptionEnabled: async (scheme?: 'nip04' | 'nip44') => {
			if (options.supportsNip44 === false) return []
			return !scheme || scheme === 'nip44' ? ['nip44'] : []
		},
		encrypt: async (recipient: TestNDKUser, plaintext: string, scheme?: 'nip04' | 'nip44') => {
			if (options.supportsNip44 === false || options.canEncrypt === false || scheme !== 'nip44') {
				throw new Error('NIP-44 encryption unavailable')
			}
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, recipient.pubkey)
			return nip44.v2.encrypt(plaintext, conversationKey)
		},
		decrypt: async (sender: TestNDKUser, ciphertext: string, scheme?: 'nip04' | 'nip44') => {
			if (options.supportsNip44 === false || scheme !== 'nip44') {
				throw new Error('NIP-44 decryption unavailable')
			}
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, sender.pubkey)
			return nip44.v2.decrypt(ciphertext, conversationKey)
		},
		sign: async (event: UnsignedEvent & { pubkey: string }) => {
			if (options.signThrows) throw new Error('sign failed')
			return finalizeEvent(event, privateKey).sig
		},
	}
}

class TestNDKEvent {
	kind?: number
	created_at?: number
	content = ''
	tags: string[][] = []
	id = ''
	pubkey = ''
	sig = ''

	constructor(_ndk?: unknown, event?: Partial<Event>) {
		if (!event) return
		this.kind = event.kind
		this.created_at = event.created_at
		this.content = event.content ?? ''
		this.tags = event.tags?.map((tag) => [...tag]) ?? []
		this.id = event.id ?? ''
		this.pubkey = event.pubkey ?? ''
		this.sig = event.sig ?? ''
	}

	async sign(signer = currentSigner) {
		if (!signer) throw new Error('No active signer')
		const user = await signer.user()
		this.pubkey = user.pubkey
		this.created_at ??= Math.floor(Date.now() / 1000)
		if (typeof this.kind !== 'number') throw new Error('Missing event kind')

		const unsignedEvent = {
			kind: this.kind,
			created_at: this.created_at,
			tags: this.tags,
			content: this.content,
			pubkey: this.pubkey,
		}
		this.id = getEventHash(unsignedEvent)
		this.sig = await signer.sign(unsignedEvent)
	}

	rawEvent(): Event {
		if (typeof this.kind !== 'number' || typeof this.created_at !== 'number') throw new Error('Incomplete test event')
		return {
			id: this.id,
			pubkey: this.pubkey,
			created_at: this.created_at,
			kind: this.kind,
			tags: this.tags.map((tag) => [...tag]),
			content: this.content,
			sig: this.sig,
		}
	}
}

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
			activeUser: currentBuyer
				? {
						pubkey: currentBuyer.pubkey,
					}
				: undefined,
		}),
		getSigner: () => currentSigner,
		publishEvent: mock(async (event: PublishedEvent) => {
			publishedEvents.push(event)
			const nextResult = publishResults.shift()
			if (nextResult instanceof Error) throw nextResult
			if (nextResult !== undefined) return nextResult
			return new Set(['wss://relay.example'])
		}),
	},
}))

mock.module('@nostr-dev-kit/ndk', () => ({
	NDKUser: TestNDKUser,
	NDKEvent: TestNDKEvent,
}))

import type { CheckoutFormData } from '@/components/checkout/ShippingAddressForm'
import { decryptPrivateOrderMessage } from '@/lib/orders/privateOrderMessage'
import { createOrder, createOrderCreationEvent, publishOrderWithDependencies } from '@/publish/orders'
import { privateDetailsMatchPublicOrder } from '@/queries/orders'

const PII_SENTINELS = [
	'buyer@example.com',
	'123 Main Street',
	'Satoshi Nakamoto',
	'+15551234567',
	'Los Angeles',
	'90210',
	'United States',
	'Apt Secret Notes',
]

const baseShippingData: CheckoutFormData = {
	name: 'Satoshi Nakamoto',
	email: 'buyer@example.com',
	phone: '+15551234567',
	firstLineOfAddress: '123 Main Street',
	zipPostcode: '90210',
	city: 'Los Angeles',
	country: 'United States',
	additionalInformation: 'Apt Secret Notes',
}

function resetTestState() {
	shippingServices = {}
	publishedEvents.length = 0
	publishResults.length = 0
	currentBuyer = createKeyPair()
	currentSigner = createSigner(currentBuyer.privateKey)
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

function publicOrderEvents() {
	return publishedEvents.filter((event) => event.kind === 16 && event.tags.some((tag) => tag[0] === 'type' && tag[1] === '1'))
}

function privateGiftWrapEvents() {
	return publishedEvents.filter((event) => event.kind === 1059)
}

function paymentRequestEvents() {
	return publishedEvents.filter((event) => event.kind === 16 && event.tags.some((tag) => tag[0] === 'type' && tag[1] === '2'))
}

function expectNoBuyerPii(value: unknown) {
	const serialized = JSON.stringify(value)
	for (const sentinel of PII_SENTINELS) {
		expect(serialized).not.toContain(sentinel)
	}
}

function expectPublicOrderEventsWithoutBuyerPii(events: PublishedEvent[]) {
	expectNoBuyerPii(events)

	for (const order of events) {
		expect(order.tags.some((tag) => tag[0] === 'address')).toBe(false)
		expect(order.tags.some((tag) => tag[0] === 'email')).toBe(false)
		expect(order.tags.some((tag) => tag[0] === 'phone')).toBe(false)
		expect(order.tags.some((tag) => tag[0] === 'name')).toBe(false)
		expect(order.content).not.toContain('buyer@example.com')
		expect(order.content).not.toContain('123 Main Street')
		expect(order.content).not.toContain('Apt Secret Notes')
	}
}

function expectPublicOrderMarkerShape(order: PublishedEvent) {
	expect(order.kind).toBe(16)
	expect(order.tags.filter((tag) => tag[0] === 'type')).toEqual([['type', '1']])
	expect(order.tags.filter((tag) => tag[0] === 'subject')).toEqual([['subject', 'order-info']])
}

function rawEventFromPublished(event: PublishedEvent): Event {
	if (event.rawEvent) return event.rawEvent()
	if (
		typeof event.kind !== 'number' ||
		typeof event.created_at !== 'number' ||
		!event.id ||
		!event.pubkey ||
		typeof event.sig !== 'string'
	) {
		throw new Error('Published event is not raw-convertible')
	}
	return {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags.map((tag) => [...tag]),
		content: event.content,
		sig: event.sig,
	}
}

function publicShippingRef(sellerPubkey: string, dTag: string) {
	return `30406:${sellerPubkey}:${dTag}`
}

function publicProductRef(sellerPubkey: string, dTag: string) {
	return `30402:${sellerPubkey}:${dTag}`
}

async function decryptGiftWrapForSeller(event: PublishedEvent, seller: TestKeyPair) {
	return decryptPrivateOrderMessage({
		giftWrap: rawEventFromPublished(event),
		sellerPrivateKey: seller.privateKey,
		expectedSellerPubkey: seller.pubkey,
		expectedBuyerPubkey: currentBuyer.pubkey,
	})
}

describe('public order privacy guard', () => {
	beforeEach(() => {
		resetTestState()
	})

	test('sanitizes the spec order creation constructor', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'pickup')
		const order = await createOrderCreationEvent({
			merchantPubkey: seller.pubkey,
			buyerPubkey: currentBuyer.pubkey,
			orderItems: [{ productRef: publicProductRef(seller.pubkey, 'product'), quantity: 1 }],
			totalAmountSats: 1000,
			shippingRef,
			shippingAddress: baseShippingData,
			email: baseShippingData.email,
			phone: baseShippingData.phone,
			notes: baseShippingData.additionalInformation,
		})

		expectPublicOrderEventsWithoutBuyerPii([order])
		expectPublicOrderMarkerShape(order)
		expect(order.tags).toContainEqual(['shipping', shippingRef])
	})

	test('sanitizes the legacy createOrder helper', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'pickup')
		await createOrder({
			productRef: publicProductRef(seller.pubkey, 'product'),
			sellerPubkey: seller.pubkey,
			quantity: 1,
			price: 1000,
			shippingRef,
			shippingAddress: baseShippingData.firstLineOfAddress,
			email: baseShippingData.email,
			phone: baseShippingData.phone,
			notes: baseShippingData.additionalInformation,
		})

		const order = publicOrderEvents()[0]
		expectPublicOrderEventsWithoutBuyerPii([order])
		expectPublicOrderMarkerShape(order)
		expect(order.tags).toContainEqual(['shipping', shippingRef])
	})

	test('rejects digital order without contact before publishing', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'digital')
		shippingServices = {
			[shippingRef]: 'digital',
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					shippingData: { email: '' },
					productsBySeller: {
						[seller.pubkey]: [{ id: 'digital-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Digital delivery contact is required')

		expect(publishedEvents).toHaveLength(0)
	})

	test('rejects physical order without address before publishing', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					shippingData: { firstLineOfAddress: '' },
					productsBySeller: {
						[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Shipping address is required')

		expect(publishedEvents).toHaveLength(0)
	})

	test('rejects unresolved delivery requirements before publishing', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'missing-service')
		shippingServices = {
			[shippingRef]: null,
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					productsBySeller: {
						[seller.pubkey]: [{ id: 'unknown-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Delivery requirements could not be verified')

		expect(publishedEvents).toHaveLength(0)
	})

	test('pickup order can publish a sanitized public order event without encrypted private details', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'pickup')
		shippingServices = {
			[shippingRef]: 'pickup',
		}

		await publishOrderWithDependencies(
			paramsFor({
				shippingData: { email: '' },
				productsBySeller: {
					[seller.pubkey]: [{ id: 'pickup-product', amount: 1, shippingMethodId: shippingRef }],
				},
			}),
		)

		expect(privateGiftWrapEvents()).toHaveLength(0)
		const order = publicOrderEvents()[0]
		expectPublicOrderEventsWithoutBuyerPii([order])
		expectPublicOrderMarkerShape(order)
		expect(order.tags).toContainEqual(['shipping', shippingRef])
	})

	test('pickup order keeps optional buyer contact out of every public order event', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'pickup')
		shippingServices = {
			[shippingRef]: 'pickup',
		}

		await publishOrderWithDependencies(
			paramsFor({
				productsBySeller: {
					[seller.pubkey]: [{ id: 'pickup-product', amount: 1, shippingMethodId: shippingRef }],
				},
			}),
		)

		expectPublicOrderEventsWithoutBuyerPii(publicOrderEvents())
	})

	test('physical delivery publishes encrypted private details before sanitized public order marker', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}

		await publishOrderWithDependencies(
			paramsFor({
				productsBySeller: {
					[seller.pubkey]: [{ id: 'physical-product', amount: 2, shippingMethodId: shippingRef }],
				},
				sellerData: {
					[seller.pubkey]: { satsTotal: 5000, shippingSats: 1000, shares: { sellerAmount: 5000 } },
				},
			}),
		)

		const giftWrap = privateGiftWrapEvents()[0]
		const order = publicOrderEvents()[0]
		expect(publishedEvents.indexOf(giftWrap)).toBeLessThan(publishedEvents.indexOf(order))
		expectNoBuyerPii(giftWrap)
		expectPublicOrderEventsWithoutBuyerPii([order])
		expectPublicOrderMarkerShape(order)

		const decrypted = await decryptGiftWrapForSeller(giftWrap, seller)
		expect(decrypted.details.delivery.name).toBe('Satoshi Nakamoto')
		expect(decrypted.details.delivery.email).toBe('buyer@example.com')
		expect(decrypted.details.delivery.phone).toBe('+15551234567')
		expect(decrypted.details.delivery.address?.firstLineOfAddress).toBe('123 Main Street')
		expect(decrypted.details.delivery.address?.additionalInformation).toBe('Apt Secret Notes')
		expect(decrypted.details.items).toEqual([{ productRef: publicProductRef(seller.pubkey, 'physical-product'), quantity: 2 }])
		expect(privateDetailsMatchPublicOrder(decrypted.details, order)).toBe(true)
	})

	test('digital delivery publishes encrypted contact details before sanitized public order marker', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'digital')
		shippingServices = {
			[shippingRef]: 'digital',
		}

		await publishOrderWithDependencies(
			paramsFor({
				productsBySeller: {
					[seller.pubkey]: [{ id: 'digital-product', amount: 1, shippingMethodId: shippingRef }],
				},
			}),
		)

		const giftWrap = privateGiftWrapEvents()[0]
		const order = publicOrderEvents()[0]
		expect(publishedEvents.indexOf(giftWrap)).toBeLessThan(publishedEvents.indexOf(order))
		expectNoBuyerPii(giftWrap)
		expectPublicOrderEventsWithoutBuyerPii([order])

		const decrypted = await decryptGiftWrapForSeller(giftWrap, seller)
		expect(decrypted.details.delivery.email).toBe('buyer@example.com')
		expect(decrypted.details.delivery.name).toBeUndefined()
		expect(decrypted.details.delivery.phone).toBeUndefined()
		expect(decrypted.details.delivery.address).toBeUndefined()
		expect(privateDetailsMatchPublicOrder(decrypted.details, order)).toBe(true)
	})

	test('missing signer fails closed before any publish for required private delivery', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}
		currentSigner = undefined

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					productsBySeller: {
						[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Encrypted seller delivery could not be prepared')

		expect(publishedEvents).toHaveLength(0)
	})

	test('signer pubkey mismatch fails closed before any publish', async () => {
		const seller = createKeyPair()
		const otherBuyer = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}
		currentSigner = createSigner(otherBuyer.privateKey)

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					productsBySeller: {
						[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Encrypted seller delivery could not be prepared')

		expect(publishedEvents).toHaveLength(0)
	})

	test('signer without NIP-44 encrypt support fails closed before any publish', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}
		currentSigner = createSigner(currentBuyer.privateKey, { supportsNip44: false })

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					productsBySeller: {
						[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Encrypted seller delivery could not be prepared')

		expect(publishedEvents).toHaveLength(0)
	})

	test('private payload construction failure fails closed before any publish', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					productsBySeller: {
						[seller.pubkey]: [{ id: 'bad\nproduct', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Encrypted seller delivery could not be prepared')

		expect(publishedEvents).toHaveLength(0)
	})

	test('encrypted gift wrap publish failure prevents public order and payment request publishes', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}
		publishResults.push(new Set())

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					productsBySeller: {
						[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('Encrypted seller delivery could not be published')

		expect(privateGiftWrapEvents()).toHaveLength(1)
		expect(publicOrderEvents()).toHaveLength(0)
		expect(paymentRequestEvents()).toHaveLength(0)
	})

	test('payment request creation is attempted only after the seller public marker publishes', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}

		await publishOrderWithDependencies(
			paramsFor({
				productsBySeller: {
					[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
				},
			}),
		)

		const giftWrap = privateGiftWrapEvents()[0]
		const order = publicOrderEvents()[0]
		const paymentRequest = paymentRequestEvents()[0]
		expect(publishedEvents.indexOf(giftWrap)).toBeLessThan(publishedEvents.indexOf(order))
		expect(publishedEvents.indexOf(order)).toBeLessThan(publishedEvents.indexOf(paymentRequest))
	})

	test('public publish after private publish propagates and does not publish payment requests', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}
		publishResults.push(new Set(['wss://relay.example']), new Error('public publish failed'))

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					productsBySeller: {
						[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
					},
				}),
			),
		).rejects.toThrow('public publish failed')

		expect(privateGiftWrapEvents()).toHaveLength(1)
		expect(publicOrderEvents()).toHaveLength(1)
		expect(paymentRequestEvents()).toHaveLength(0)
	})

	test('multi-seller checkout publishes all private gift wraps before any public order marker', async () => {
		const physicalSeller = createKeyPair()
		const digitalSeller = createKeyPair()
		const physicalShippingRef = publicShippingRef(physicalSeller.pubkey, 'standard')
		const digitalShippingRef = publicShippingRef(digitalSeller.pubkey, 'digital')
		shippingServices = {
			[physicalShippingRef]: 'standard',
			[digitalShippingRef]: 'digital',
		}

		await publishOrderWithDependencies(
			paramsFor({
				sellers: [physicalSeller.pubkey, digitalSeller.pubkey],
				productsBySeller: {
					[physicalSeller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: physicalShippingRef }],
					[digitalSeller.pubkey]: [{ id: 'digital-product', amount: 3, shippingMethodId: digitalShippingRef }],
				},
			}),
		)

		const giftWraps = privateGiftWrapEvents()
		const orders = publicOrderEvents()
		expect(giftWraps).toHaveLength(2)
		expect(orders).toHaveLength(2)

		const firstPublicOrderIndex = Math.min(...orders.map((order) => publishedEvents.indexOf(order)))
		for (const giftWrap of giftWraps) {
			expect(publishedEvents.indexOf(giftWrap)).toBeLessThan(firstPublicOrderIndex)
			expectNoBuyerPii(giftWrap)
		}

		const physicalDetails = await decryptGiftWrapForSeller(
			giftWraps.find((event) => event.tags[0]?.[1] === physicalSeller.pubkey) as PublishedEvent,
			physicalSeller,
		)
		const digitalDetails = await decryptGiftWrapForSeller(
			giftWraps.find((event) => event.tags[0]?.[1] === digitalSeller.pubkey) as PublishedEvent,
			digitalSeller,
		)

		expect(physicalDetails.details.items).toEqual([
			{ productRef: publicProductRef(physicalSeller.pubkey, 'physical-product'), quantity: 1 },
		])
		expect(digitalDetails.details.items).toEqual([{ productRef: publicProductRef(digitalSeller.pubkey, 'digital-product'), quantity: 3 }])
		expect(digitalDetails.details.delivery.email).toBe('buyer@example.com')
		expect(digitalDetails.details.delivery.name).toBeUndefined()
		expect(digitalDetails.details.delivery.address).toBeUndefined()
		expect(digitalDetails.details.delivery.phone).toBeUndefined()
		expect(JSON.stringify(physicalDetails.details.items)).not.toContain(digitalSeller.pubkey)
		expect(JSON.stringify(digitalDetails.details.items)).not.toContain(physicalSeller.pubkey)
		expectPublicOrderEventsWithoutBuyerPii(orders)
	})

	test('multi-seller private payload preparation failure publishes nothing', async () => {
		const pickupSeller = createKeyPair()
		const physicalSeller = createKeyPair()
		const pickupShippingRef = publicShippingRef(pickupSeller.pubkey, 'pickup')
		const physicalShippingRef = publicShippingRef(physicalSeller.pubkey, 'standard')
		shippingServices = {
			[pickupShippingRef]: 'pickup',
			[physicalShippingRef]: 'standard',
		}

		await expect(
			publishOrderWithDependencies(
				paramsFor({
					sellers: [pickupSeller.pubkey, physicalSeller.pubkey],
					productsBySeller: {
						[pickupSeller.pubkey]: [{ id: 'pickup-product', amount: 1, shippingMethodId: pickupShippingRef }],
						[physicalSeller.pubkey]: [{ id: 'bad\nproduct', amount: 1, shippingMethodId: physicalShippingRef }],
					},
				}),
			),
		).rejects.toThrow('Encrypted seller delivery could not be prepared')

		expect(publishedEvents).toHaveLength(0)
	})

	test('serialized public and gift-wrap events do not expose buyer PII sentinels', async () => {
		const seller = createKeyPair()
		const shippingRef = publicShippingRef(seller.pubkey, 'standard')
		shippingServices = {
			[shippingRef]: 'standard',
		}

		await publishOrderWithDependencies(
			paramsFor({
				productsBySeller: {
					[seller.pubkey]: [{ id: 'physical-product', amount: 1, shippingMethodId: shippingRef }],
				},
			}),
		)

		expectNoBuyerPii(publicOrderEvents())
		expectNoBuyerPii(privateGiftWrapEvents())
	})
})
