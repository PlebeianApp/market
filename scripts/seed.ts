// seed.ts
import { devUser1, devUser2, devUser3, devUser4, devUser5 } from '@/lib/fixtures'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { config } from 'dotenv'
import { createCollectionEvent, createProductReference, generateCollectionData } from './gen_collections'
import { createProductEvent, generateProductData } from './gen_products'
import { createReviewEvent, generateReviewData } from './gen_review'
import { createShippingEvent, generateShippingData } from './gen_shipping'
import { createV4VSharesEvent } from './gen_v4v'
import { ORDER_STATUS } from '@/lib/schemas/order'
import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
import { createUserProfileEvent, generateUserProfileData } from './gen_user'
import { 
	createOrderEvent,
	createOrderStatusEvent,
	createPaymentRequestEvent,
	createPaymentReceiptEvent,
	createShippingUpdateEvent,
	generateOrderCreationData,
	generateOrderStatusData,
	generatePaymentRequestData,
	generatePaymentReceiptData,
	generateShippingUpdateData
} from './gen_orders'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PUBKEY = process.env.APP_PUBKEY

if (!RELAY_URL) {
	console.error('Missing required environment variables')
	process.exit(1)
}

const ndk = ndkActions.initialize([RELAY_URL])
const devUsers = [devUser1, devUser2, devUser3, devUser4, devUser5]

async function seedData() {
	const PRODUCTS_PER_USER = 6
	const SHIPPING_OPTIONS_PER_USER = 4
	const COLLECTIONS_PER_USER = 2
	const REVIEWS_PER_USER = 2
	const ORDERS_PER_PAIR = 3 // Each user will place this many orders with each other user

	console.log('Connecting to Nostr...')
	console.log(ndkActions.getNDK()?.explicitRelayUrls)
	await ndkActions.connect()
	const productsByUser: Record<string, string[]> = {}
	const allProductRefs: string[] = []
	const shippingsByUser: Record<string, string[]> = {}
	const userPubkeys: string[] = []

	console.log('Starting seeding...')

	// Create user profiles, products and shipping options for each user
	for (let i = 0; i < devUsers.length; i++) {
		const user = devUsers[i]
		const signer = new NDKPrivateKeySigner(user.sk)
		await signer.blockUntilReady()
		const pubkey = (await signer.user()).pubkey
		userPubkeys.push(pubkey)

		// Create user profile with user index for more personalized data
		console.log(`Creating profile for user ${pubkey.substring(0, 8)}...`)
		const userProfile = generateUserProfileData(i)
		await createUserProfileEvent(signer, ndk, userProfile)

		console.log(`Creating products for user ${pubkey.substring(0, 8)}...`)
		productsByUser[pubkey] = []

		// Create products
		for (let j = 0; j < PRODUCTS_PER_USER; j++) {
			const product = generateProductData()
			const success = await createProductEvent(signer, ndk, product)
			if (success) {
				const productId = product.tags.find((tag) => tag[0] === 'd')?.[1]
				if (productId) {
					const productRef = createProductReference(pubkey, productId)
					productsByUser[pubkey].push(productRef)
					allProductRefs.push(productRef)
				}
			}
		}

		// Create shipping options
		console.log(`Creating shipping options for user ${pubkey.substring(0, 8)}...`)
		shippingsByUser[pubkey] = []

		for (let j = 0; j < SHIPPING_OPTIONS_PER_USER; j++) {
			const shipping = generateShippingData()
			const success = await createShippingEvent(signer, ndk, shipping)
			if (success) {
				const shippingId = shipping.tags.find((tag) => tag[0] === 'd')?.[1]
				if (shippingId) {
					shippingsByUser[pubkey].push(`${SHIPPING_KIND}:${pubkey}:${shippingId}`)
				}
			}
		}

		// Create V4V shares for each user
		console.log(`Creating V4V shares for user ${pubkey.substring(0, 8)}...`)
		await createV4VSharesEvent(signer, ndk, APP_PUBKEY)
	}

	// Create collections
	console.log('Creating collections...')
	for (const user of devUsers) {
		const signer = new NDKPrivateKeySigner(user.sk)
		await signer.blockUntilReady()
		const pubkey = (await signer.user()).pubkey

		console.log(`Creating collections for user ${pubkey.substring(0, 8)}...`)

		for (let i = 0; i < COLLECTIONS_PER_USER; i++) {
			const collectionProducts = productsByUser[pubkey] || []
			const collection = generateCollectionData(collectionProducts)
			await createCollectionEvent(signer, ndk, collection)
		}
	}

	// Create reviews
	console.log('Creating reviews...')
	for (const user of devUsers) {
		const signer = new NDKPrivateKeySigner(user.sk)
		await signer.blockUntilReady()
		const pubkey = (await signer.user()).pubkey

		// Get products to review (excluding own products)
		const productsToReview = allProductRefs.filter((ref) => {
			const refPubkey = ref.split(':')[2]
			return refPubkey !== pubkey
		})

		console.log(`Creating reviews for user ${pubkey.substring(0, 8)}...`)

		for (let i = 0; i < REVIEWS_PER_USER; i++) {
			if (productsToReview[i]) {
				const review = generateReviewData([productsToReview[i]])
				await createReviewEvent(signer, ndk, review)
			}
		}
	}

	// Create orders between all users
	console.log('Creating orders between all users...')
	
	// For each pair of users
	for (let buyerIndex = 0; buyerIndex < userPubkeys.length; buyerIndex++) {
		const buyerPubkey = userPubkeys[buyerIndex]
		const buyerUser = devUsers[buyerIndex]
		const buyerSigner = new NDKPrivateKeySigner(buyerUser.sk)
		await buyerSigner.blockUntilReady()
		
		console.log(`Creating orders for buyer ${buyerPubkey.substring(0, 8)}...`)
		
		// Loop through all other users as sellers
		for (let sellerIndex = 0; sellerIndex < userPubkeys.length; sellerIndex++) {
			// Skip self (can't buy from yourself)
			if (sellerIndex === buyerIndex) continue;
			
			const sellerPubkey = userPubkeys[sellerIndex]
			const sellerUser = devUsers[sellerIndex]
			const sellerSigner = new NDKPrivateKeySigner(sellerUser.sk)
			await sellerSigner.blockUntilReady()
			
			console.log(`  Creating orders from ${buyerPubkey.substring(0, 8)} to ${sellerPubkey.substring(0, 8)}...`)
			
			// Get products from this seller
			const sellerProducts = productsByUser[sellerPubkey] || []
			if (sellerProducts.length === 0) continue;
			
			// Create multiple orders for each buyer-seller pair
			for (let i = 0; i < ORDERS_PER_PAIR; i++) {
				// Randomly select a product from seller
				const productRef = sellerProducts[Math.floor(Math.random() * sellerProducts.length)]
				
				// Create order (buyer to merchant)
				const orderData = generateOrderCreationData(buyerPubkey, sellerPubkey, productRef)
				const orderEventId = await createOrderEvent(buyerSigner, ndk, orderData)
				
				if (orderEventId) {
					// Get order id from tags
					const orderId = orderData.tags.find(tag => tag[0] === 'order')?.[1]
					const totalAmount = orderData.tags.find(tag => tag[0] === 'amount')?.[1] || '0'
					
					if (orderId) {
						// Create payment request (merchant to buyer)
						const paymentRequestData = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
						await createPaymentRequestEvent(sellerSigner, ndk, paymentRequestData)

						// Create payment receipt (buyer to merchant)
						const paymentReceiptData = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount)
						await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData)

						// Create status updates (merchant to buyer)
						// Create different status updates based on order number to have variety
						if (i === 0) {
							// First order: confirmed only
							const statusData = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
							await createOrderStatusEvent(sellerSigner, ndk, statusData)
						} else if (i === 1) {
							// Second order: confirmed and processing
							const statusData1 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
							await createOrderStatusEvent(sellerSigner, ndk, statusData1)
							
							const statusData2 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING)
							await createOrderStatusEvent(sellerSigner, ndk, statusData2)
							
							// Add shipping update
							const shippingData = generateShippingUpdateData(buyerPubkey, orderId, 'processing')
							await createShippingUpdateEvent(sellerSigner, ndk, shippingData)
						} else {
							// Third order: complete flow
							const statusData1 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
							await createOrderStatusEvent(sellerSigner, ndk, statusData1)
							
							const statusData2 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING)
							await createOrderStatusEvent(sellerSigner, ndk, statusData2)
							
							const shippingData = generateShippingUpdateData(buyerPubkey, orderId, 'shipped')
							await createShippingUpdateEvent(sellerSigner, ndk, shippingData)
							
							const statusData3 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.COMPLETED)
							await createOrderStatusEvent(sellerSigner, ndk, statusData3)
						}
					}
				}
			}
		}
	}

	console.log('Seeding complete!')
	process.exit(0)
}

seedData().catch((error) => {
	console.error('Seeding failed:', error)
	process.exit(1)
})
