import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { devUser1 } from '@/lib/fixtures'
import { productFormStore, productFormActions, DEFAULT_FORM_STATE } from '@/lib/stores/product'
import { fetchProduct, getProductTitle, getProductDescription, getProductPrice, getProductImages } from '@/queries/products'

const RELAY_URL = process.env.APP_RELAY_URL
if (!RELAY_URL) {
	throw new Error('APP_RELAY_URL is not set')
}

// Test product data
const TEST_PRODUCT = {
	name: 'Test Product',
	description: 'This is a test product description',
	price: '10000',
	quantity: '5',
	currency: 'SATS',
	status: 'on-sale' as const,
	productType: 'single' as const,
	mainCategory: 'Bitcoin',
	specs: [{ key: 'Weight', value: '5 kg' }],
	images: [
		{
			imageUrl:
				process.env.E2E_TEST_IMAGE_URL ||
				'https://blossom2.orangesync.tech/f03167b3052fb1311af8f75dcd2e6a8d5e3d5f01920a9eb4004f97fd04b47546.png',
			imageOrder: 0,
		},
	],
	categories: [{ key: 'cat1', name: 'Bitcoin Miners', checked: true }],
}

describe('Product Publishing', () => {
	// Set up test environment
	beforeEach(async () => {
		// Initialize NDK with test relay
		ndkActions.initialize([RELAY_URL])
		await ndkActions.connect()

		// Reset product form state
		productFormActions.reset()
	})

	afterEach(() => {
		// Clean up
		productFormActions.reset()
	})

	test('should publish a product and retrieve it correctly', async () => {
		// Set up the signer with devUser1
		const signer = new NDKPrivateKeySigner(devUser1.sk)
		await signer.blockUntilReady()

		// Set the signer in the NDK store
		ndkActions.setSigner(signer)

		// Get the NDK instance
		const ndk = ndkActions.getNDK()
		expect(ndk).not.toBeNull()

		// Verify we're only using the local relay
		expect(ndk!.explicitRelayUrls).toEqual([RELAY_URL])

		// Set up a test product in the product form store
		productFormStore.setState((state) => ({
			...state,
			...TEST_PRODUCT,
		}))

		// Publish the product
		const publishResult = await productFormActions.publishProduct(signer, ndk!)
		expect(typeof publishResult).toBe('string')

		// Use the event ID from publishResult
		const productId = publishResult as string

		// Get all products by the user's pubkey to find our newly created product
		const userPubkey = (await signer.user()).pubkey
		const userEvents = await ndk!.fetchEvents({
			kinds: [30402],
			authors: [userPubkey],
			limit: 10,
		})

		// Find the most recent product (should be the one we just created)
		const productEvent = Array.from(userEvents).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]

		expect(productEvent).toBeDefined()

		// Fetch the product using the query functions
		const retrievedProduct = await fetchProduct(productId)

		// Verify the product data is correct
		expect(getProductTitle(retrievedProduct)).toBe(TEST_PRODUCT.name)
		expect(getProductDescription(retrievedProduct)).toBe(TEST_PRODUCT.description)

		const priceTag = getProductPrice(retrievedProduct)
		expect(priceTag).toBeDefined()
		expect(priceTag?.[1]).toBe(TEST_PRODUCT.price)
		expect(priceTag?.[2]).toBe(TEST_PRODUCT.currency)

		const images = getProductImages(retrievedProduct)
		expect(images.length).toBe(TEST_PRODUCT.images.length)
		expect(images[0][1]).toBe(TEST_PRODUCT.images[0].imageUrl)

		// Reset the product form state
		productFormActions.reset()
		expect(productFormStore.state).toEqual(DEFAULT_FORM_STATE)
	})
})
