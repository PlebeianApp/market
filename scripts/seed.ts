// seed.ts
import { devUser1, devUser2, devUser3, devUser4, devUser5, WALLETED_USER_LUD16, XPUB } from '@/lib/fixtures'
import { ORDER_STATUS, SHIPPING_STATUS } from '@/lib/schemas/order'
import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
import { ndkActions } from '@/lib/stores/ndk'
import { createFeaturedCollectionsEvent, createFeaturedProductsEvent, createFeaturedUsersEvent } from '@/publish/featured'
import { hexToBytes } from '@noble/hashes/utils'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { config } from 'dotenv'
import { getPublicKey } from 'nostr-tools/pure'
import { createCollectionEvent, createProductReference, generateCollectionData } from './gen_collections'
import {
	createGeneralCommunicationEvent,
	createMultiplePaymentRequestEvents,
	createOrderEvent,
	createOrderStatusEvent,
	createPaymentReceiptsForOrder,
	createShippingUpdateEvent,
	generateGeneralCommunicationData,
	generateOrderCreationData,
	generateOrderStatusData,
	generateShippingUpdateData,
} from './gen_orders'
import { createPaymentDetailEvent, generateLightningPaymentDetail, generateOnChainPaymentDetail } from './gen_payment_details'
import { createProductEvent, generateProductData } from './gen_products'
import { createReviewEvent, generateReviewData } from './gen_review'
import { createShippingEvent, generatePickupShippingData, generateShippingData } from './gen_shipping'
import { createUserProfileEvent, generateUserProfileData } from './gen_user'
import { createV4VSharesEvent } from './gen_v4v'
import { createUserNwcWallets } from './gen_wallets'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

// Timestamps for seeding (seconds since epoch)
const MIN_SEED_TIMESTAMP = 1704067200 // January 1, 2024, 00:00:00 UTC
const MAX_SEED_TIMESTAMP = 1748927999 // June 3, 2025, 23:59:59 UTC

// Helper to get a random timestamp within the defined seeding range
// This is duplicated from gen_orders.ts for use here. Ideally, it could be shared.
function getRandomPastTimestamp(min = MIN_SEED_TIMESTAMP, max = MAX_SEED_TIMESTAMP): number {
	// Use Math.random for simplicity if faker is not available/imported here directly
	// However, gen_orders.ts uses faker, so for consistency, if this script grows, consider sharing.
	return Math.floor(Math.random() * (max - min + 1)) + min
}

if (!RELAY_URL) {
	console.error('Missing required environment variables')
	process.exit(1)
}

if (!APP_PRIVATE_KEY) {
	console.error('APP_PRIVATE_KEY environment variable is required for seeding payment details')
	console.error('Please set APP_PRIVATE_KEY in your .env file')
	process.exit(1)
}

// Derive the public key from the private key
const APP_PUBKEY = getPublicKey(hexToBytes(APP_PRIVATE_KEY))

const ndk = ndkActions.initialize([RELAY_URL])
const devUsers = [devUser1, devUser2, devUser3, devUser4, devUser5]

async function seedData() {
	const PRODUCTS_PER_USER = 6
	const SHIPPING_OPTIONS_PER_USER = 4
	const COLLECTIONS_PER_USER = 2
	const REVIEWS_PER_USER = 2
	const ORDERS_PER_PAIR = 6 // Increased to demonstrate all order states

	console.log('Connecting to Nostr...')
	console.log(ndkActions.getNDK()?.explicitRelayUrls)
	await ndkActions.connect()
	const productsByUser: Record<string, string[]> = {}
	const allProductRefs: string[] = []
	const shippingsByUser: Record<string, string[]> = {}
	const userPubkeys: string[] = []
	const allCollectionCoords: string[] = []

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

		// Create payment details for each user (one Lightning, one On-chain)
		console.log(`Creating payment details for user ${pubkey.substring(0, 8)}...`)

		// Create Lightning Network payment detail
		const lightningPaymentDetail = generateLightningPaymentDetail(WALLETED_USER_LUD16)
		await createPaymentDetailEvent(signer, ndk, lightningPaymentDetail, APP_PUBKEY!)

		// Create On-chain payment detail (using the same XPUB for all users)
		const onChainPaymentDetail = generateOnChainPaymentDetail(XPUB)
		await createPaymentDetailEvent(signer, ndk, onChainPaymentDetail, APP_PUBKEY!)

		// Create NWC wallets for each user (2 wallets with organic names)
		console.log(`Creating NWC wallets for user ${pubkey.substring(0, 8)}...`)
		await createUserNwcWallets(signer, pubkey, 2)

		// Create shipping options first
		console.log(`Creating shipping options for user ${pubkey.substring(0, 8)}...`)
		shippingsByUser[pubkey] = []

		// Create one pickup shipping option for each user
		const pickupShipping = generatePickupShippingData()
		const pickupSuccess = await createShippingEvent(signer, ndk, pickupShipping)
		if (pickupSuccess) {
			const pickupShippingId = pickupShipping.tags.find((tag) => tag[0] === 'd')?.[1]
			if (pickupShippingId) {
				shippingsByUser[pubkey].push(`${SHIPPING_KIND}:${pubkey}:${pickupShippingId}`)
			}
		}

		// Create regular shipping options
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

		console.log(`Creating products for user ${pubkey.substring(0, 8)}...`)
		productsByUser[pubkey] = []

		// Create products with shipping options
		for (let j = 0; j < PRODUCTS_PER_USER; j++) {
			// Use the shipping options from this user for their products
			const userShippingRefs = shippingsByUser[pubkey] || []
			const product = generateProductData(userShippingRefs)
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

		// Create V4V shares for each user (excluding themselves from potential recipients)
		console.log(`Creating V4V shares for user ${pubkey.substring(0, 8)}...`)
		const otherUserPubkeys = userPubkeys.filter((otherPubkey) => otherPubkey !== pubkey)
		await createV4VSharesEvent(signer, ndk, APP_PUBKEY, otherUserPubkeys)
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
			const success = await createCollectionEvent(signer, ndk, collection)
			if (success) {
				const collectionId = collection.tags.find((tag) => tag[0] === 'd')?.[1]
				if (collectionId) {
					allCollectionCoords.push(`30405:${pubkey}:${collectionId}`)
				}
			}
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
	console.log('🔄 Each order will generate multiple payment requests according to V4V shares:')
	console.log('   • 1 payment request for merchant share')
	console.log('   • N payment requests for V4V recipient shares (if any)')
	console.log('   • All following gamma marketplace spec (Kind 16, type 2)\n')

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
			if (sellerIndex === buyerIndex) continue

			const sellerPubkey = userPubkeys[sellerIndex]
			const sellerUser = devUsers[sellerIndex]
			const sellerSigner = new NDKPrivateKeySigner(sellerUser.sk)
			await sellerSigner.blockUntilReady()

			console.log(`  Creating orders from ${buyerPubkey.substring(0, 8)} to ${sellerPubkey.substring(0, 8)}...`)

			// Get products from this seller
			const sellerProducts = productsByUser[sellerPubkey] || []
			if (sellerProducts.length === 0) continue

			// Create multiple orders for each buyer-seller pair
			// Each order demonstrates V4V-aware payment requests: 1 merchant + N V4V recipients
			for (let i = 0; i < ORDERS_PER_PAIR; i++) {
				// Randomly select a product from seller
				const productRef = sellerProducts[Math.floor(Math.random() * sellerProducts.length)]

				// Initialize the base timestamp for this order sequence to be in the past
				let lastEventTimestamp: number | undefined = getRandomPastTimestamp()

				// Create order (buyer to merchant) - pass the initial lastEventTimestamp
				const orderData = generateOrderCreationData(buyerPubkey, sellerPubkey, productRef, lastEventTimestamp)
				let { eventId: orderEventId, createdAt: currentTimestamp } = await createOrderEvent(buyerSigner, ndk, orderData)
				lastEventTimestamp = currentTimestamp // This is now the definitive timestamp from gen_orders.ts

				if (orderEventId) {
					const orderId = orderData.tags.find((tag) => tag[0] === 'order')?.[1]
					const totalAmount = orderData.tags.find((tag) => tag[0] === 'amount')?.[1] || '0'

					if (orderId) {
						// Add a general message from buyer after placing order
						let kind14Data = generateGeneralCommunicationData(sellerPubkey, orderId, lastEventTimestamp)
						;({ createdAt: currentTimestamp } = await createGeneralCommunicationEvent(buyerSigner, ndk, kind14Data))
						lastEventTimestamp = currentTimestamp

						switch (i) {
							case 0:
								console.log(`    Order ${i + 1}: PENDING state (awaiting payment)`)
								const paymentRequestResults = await createMultiplePaymentRequestEvents(
									sellerSigner,
									ndk,
									buyerPubkey,
									sellerPubkey,
									orderId,
									totalAmount,
									lastEventTimestamp,
								)
								if (paymentRequestResults.length > 0) {
									lastEventTimestamp = Math.max(...paymentRequestResults.map((r) => r.createdAt))
								}
								break

							case 1:
								console.log(`    Order ${i + 1}: CONFIRMED state`)
								let paymentReqResults = await createMultiplePaymentRequestEvents(
									sellerSigner,
									ndk,
									buyerPubkey,
									sellerPubkey,
									orderId,
									totalAmount,
									lastEventTimestamp,
								)
								if (paymentReqResults.length > 0) {
									lastEventTimestamp = Math.max(...paymentReqResults.map((r) => r.createdAt))
								}

								// Create payment receipts for all payment requests
								const receiptResults = await createPaymentReceiptsForOrder(buyerSigner, ndk, orderId, paymentReqResults, lastEventTimestamp)
								if (receiptResults.length > 0) {
									lastEventTimestamp = Math.max(...receiptResults.map((r) => r.createdAt))
								}

								// Add a general message from seller after payment
								kind14Data = generateGeneralCommunicationData(buyerPubkey, orderId, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createGeneralCommunicationEvent(sellerSigner, ndk, kind14Data))
								lastEventTimestamp = currentTimestamp

								const statusConfirmed = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
								await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed)
								break

							case 2:
								console.log(`    Order ${i + 1}: PROCESSING state`)
								let paymentReqResults2 = await createMultiplePaymentRequestEvents(
									sellerSigner,
									ndk,
									buyerPubkey,
									sellerPubkey,
									orderId,
									totalAmount,
									lastEventTimestamp,
								)
								if (paymentReqResults2.length > 0) {
									lastEventTimestamp = Math.max(...paymentReqResults2.map((r) => r.createdAt))
								}

								// Create payment receipts for all payment requests
								const receiptResults2 = await createPaymentReceiptsForOrder(
									buyerSigner,
									ndk,
									orderId,
									paymentReqResults2,
									lastEventTimestamp,
								)
								if (receiptResults2.length > 0) {
									lastEventTimestamp = Math.max(...receiptResults2.map((r) => r.createdAt))
								}

								const statusConfirmed2 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed2))
								lastEventTimestamp = currentTimestamp

								const statusProcessing = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING, lastEventTimestamp)
								await createOrderStatusEvent(sellerSigner, ndk, statusProcessing)
								break

							case 3:
								console.log(`    Order ${i + 1}: SHIPPED state (processing + shipping)`)
								let paymentReqResults3 = await createMultiplePaymentRequestEvents(
									sellerSigner,
									ndk,
									buyerPubkey,
									sellerPubkey,
									orderId,
									totalAmount,
									lastEventTimestamp,
								)
								if (paymentReqResults3.length > 0) {
									lastEventTimestamp = Math.max(...paymentReqResults3.map((r) => r.createdAt))
								}

								// Create payment receipts for all payment requests
								const receiptResults3 = await createPaymentReceiptsForOrder(
									buyerSigner,
									ndk,
									orderId,
									paymentReqResults3,
									lastEventTimestamp,
								)
								if (receiptResults3.length > 0) {
									lastEventTimestamp = Math.max(...receiptResults3.map((r) => r.createdAt))
								}

								const statusConfirmed3 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed3))
								lastEventTimestamp = currentTimestamp

								const statusProcessing2 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusProcessing2))
								lastEventTimestamp = currentTimestamp

								// Add a general message from seller before shipping
								kind14Data = generateGeneralCommunicationData(buyerPubkey, orderId, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createGeneralCommunicationEvent(sellerSigner, ndk, kind14Data))
								lastEventTimestamp = currentTimestamp

								const shippingData = generateShippingUpdateData(buyerPubkey, orderId, SHIPPING_STATUS.SHIPPED, lastEventTimestamp)
								await createShippingUpdateEvent(sellerSigner, ndk, shippingData)
								break

							case 4:
								console.log(`    Order ${i + 1}: COMPLETED state`)
								let paymentReqResults4 = await createMultiplePaymentRequestEvents(
									sellerSigner,
									ndk,
									buyerPubkey,
									sellerPubkey,
									orderId,
									totalAmount,
									lastEventTimestamp,
								)
								if (paymentReqResults4.length > 0) {
									lastEventTimestamp = Math.max(...paymentReqResults4.map((r) => r.createdAt))
								}

								// Create payment receipts for all payment requests
								const receiptResults4 = await createPaymentReceiptsForOrder(
									buyerSigner,
									ndk,
									orderId,
									paymentReqResults4,
									lastEventTimestamp,
								)
								if (receiptResults4.length > 0) {
									lastEventTimestamp = Math.max(...receiptResults4.map((r) => r.createdAt))
								}

								const statusConfirmed4 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed4))
								lastEventTimestamp = currentTimestamp

								const statusProcessing3 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusProcessing3))
								lastEventTimestamp = currentTimestamp

								const shippingData2 = generateShippingUpdateData(buyerPubkey, orderId, SHIPPING_STATUS.SHIPPED, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createShippingUpdateEvent(sellerSigner, ndk, shippingData2))
								lastEventTimestamp = currentTimestamp

								// Add a general message from buyer after receiving
								kind14Data = generateGeneralCommunicationData(sellerPubkey, orderId, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createGeneralCommunicationEvent(buyerSigner, ndk, kind14Data))
								lastEventTimestamp = currentTimestamp

								const statusCompleted = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.COMPLETED, lastEventTimestamp)
								await createOrderStatusEvent(sellerSigner, ndk, statusCompleted)
								break

							case 5:
								console.log(`    Order ${i + 1}: CANCELLED state`)
								const cancelStage = Math.floor(Math.random() * 3)

								// Always create payment requests
								let paymentReqResults5 = await createMultiplePaymentRequestEvents(
									sellerSigner,
									ndk,
									buyerPubkey,
									sellerPubkey,
									orderId,
									totalAmount,
									lastEventTimestamp,
								)
								if (paymentReqResults5.length > 0) {
									lastEventTimestamp = Math.max(...paymentReqResults5.map((r) => r.createdAt))
								}

								if (cancelStage >= 1) {
									// Create payment receipts for confirmed orders that got cancelled
									const receiptResults5 = await createPaymentReceiptsForOrder(
										buyerSigner,
										ndk,
										orderId,
										paymentReqResults5,
										lastEventTimestamp,
									)
									if (receiptResults5.length > 0) {
										lastEventTimestamp = Math.max(...receiptResults5.map((r) => r.createdAt))
									}

									const statusConfirmed5 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
									;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed5))
									lastEventTimestamp = currentTimestamp
								}

								if (cancelStage >= 2) {
									const statusProcessing4 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING, lastEventTimestamp)
									;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusProcessing4))
									lastEventTimestamp = currentTimestamp
								}

								// Add a general message about cancellation reason
								const isBuyerCancelling = Math.random() > 0.5
								const canceller = isBuyerCancelling ? buyerSigner : sellerSigner
								const recipientForCancelReason = isBuyerCancelling ? sellerPubkey : buyerPubkey
								kind14Data = generateGeneralCommunicationData(recipientForCancelReason, orderId, lastEventTimestamp)
								kind14Data.content = "I've had to cancel this order, sorry for any inconvenience."
								;({ createdAt: currentTimestamp } = await createGeneralCommunicationEvent(canceller, ndk, kind14Data))
								lastEventTimestamp = currentTimestamp

								const recipientForStatus = isBuyerCancelling ? sellerPubkey : buyerPubkey
								const statusCancelled = generateOrderStatusData(recipientForStatus, orderId, ORDER_STATUS.CANCELLED, lastEventTimestamp)
								await createOrderStatusEvent(canceller, ndk, statusCancelled)
								break

							default:
								break
						}
					}
				}
			}
		}
	}

	// Create featured items for the app
	console.log('Creating featured items...')
	if (!APP_PRIVATE_KEY) {
		console.error('APP_PRIVATE_KEY is required for creating featured items')
		return
	}
	const appSigner = new NDKPrivateKeySigner(APP_PRIVATE_KEY)
	await appSigner.blockUntilReady()

	// Get random users for featured users (3 users)
	const featuredUserPubkeys = userPubkeys.slice(0, 3)

	// Get random product coordinates for featured products (10 products)
	const featuredProductCoords = allProductRefs.slice(0, 10)

	// Get random collection coordinates for featured collections (4 collections)
	// Use the actual collection coordinates from seeded collections
	const featuredCollectionCoords = allCollectionCoords.slice(0, 5)

	try {
		// Publish featured users
		if (featuredUserPubkeys.length > 0) {
			console.log(`Publishing ${featuredUserPubkeys.length} featured users...`)
			const featuredUsersEvent = createFeaturedUsersEvent({ featuredUsers: featuredUserPubkeys }, appSigner, ndk)
			await featuredUsersEvent.sign(appSigner)
			await featuredUsersEvent.publish()
		}

		// Publish featured collections
		if (featuredCollectionCoords.length > 0) {
			console.log(`Publishing ${featuredCollectionCoords.length} featured collections...`)
			const featuredCollectionsEvent = createFeaturedCollectionsEvent({ featuredCollections: featuredCollectionCoords }, appSigner, ndk)
			await featuredCollectionsEvent.sign(appSigner)
			await featuredCollectionsEvent.publish()
		}

		// Publish featured products
		if (featuredProductCoords.length > 0) {
			console.log(`Publishing ${featuredProductCoords.length} featured products...`)
			const featuredProductsEvent = createFeaturedProductsEvent({ featuredProducts: featuredProductCoords }, appSigner, ndk)
			await featuredProductsEvent.sign(appSigner)
			await featuredProductsEvent.publish()
		}

		console.log('Featured items created successfully!')
	} catch (error) {
		console.error('Failed to create featured items:', error)
	}

	console.log('Seeding complete!')
	process.exit(0)
}

seedData().catch((error) => {
	console.error('Seeding failed:', error)
	process.exit(1)
})
