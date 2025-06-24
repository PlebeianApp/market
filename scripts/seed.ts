// seed.ts
import { devUser1, devUser2, devUser3, devUser4, devUser5, XPUB, WALLETED_USER_LUD16 } from '@/lib/fixtures'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { config } from 'dotenv'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { createCollectionEvent, createProductReference, generateCollectionData } from './gen_collections'
import { createPaymentDetailEvent, generateLightningPaymentDetail, generateOnChainPaymentDetail } from './gen_payment_details'
import { createProductEvent, generateProductData } from './gen_products'
import { createUserNwcWallets } from './gen_wallets'
import { createReviewEvent, generateReviewData } from './gen_review'
import { createShippingEvent, generateShippingData } from './gen_shipping'
import { createV4VSharesEvent } from './gen_v4v'
import { ORDER_STATUS, SHIPPING_STATUS } from '@/lib/schemas/order'
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
	generateShippingUpdateData,
	createGeneralCommunicationEvent,
	generateGeneralCommunicationData,
} from './gen_orders'

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
								const paymentRequestData = generatePaymentRequestData(buyerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentRequestEvent(sellerSigner, ndk, paymentRequestData))
								lastEventTimestamp = currentTimestamp
								break

							case 1:
								console.log(`    Order ${i + 1}: CONFIRMED state`)
								let paymentReqData = generatePaymentRequestData(buyerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData))
								lastEventTimestamp = currentTimestamp

								let paymentReceiptData = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData))
								lastEventTimestamp = currentTimestamp

								// Add a general message from seller after payment
								kind14Data = generateGeneralCommunicationData(buyerPubkey, orderId, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createGeneralCommunicationEvent(sellerSigner, ndk, kind14Data))
								lastEventTimestamp = currentTimestamp

								const statusConfirmed = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
								await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed)
								break

							case 2:
								console.log(`    Order ${i + 1}: PROCESSING state`)
								let paymentReqData2 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData2))
								lastEventTimestamp = currentTimestamp

								let paymentReceiptData2 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData2))
								lastEventTimestamp = currentTimestamp

								const statusConfirmed2 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed2))
								lastEventTimestamp = currentTimestamp

								const statusProcessing = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING, lastEventTimestamp)
								await createOrderStatusEvent(sellerSigner, ndk, statusProcessing)
								break

							case 3:
								console.log(`    Order ${i + 1}: SHIPPED state (processing + shipping)`)
								let paymentReqData3 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData3))
								lastEventTimestamp = currentTimestamp

								let paymentReceiptData3 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData3))
								lastEventTimestamp = currentTimestamp

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
								let paymentReqData4 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData4))
								lastEventTimestamp = currentTimestamp

								let paymentReceiptData4 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount, lastEventTimestamp)
								;({ createdAt: currentTimestamp } = await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData4))
								lastEventTimestamp = currentTimestamp

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

								if (cancelStage >= 1) {
									let paymentReqData5 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount, lastEventTimestamp)
									;({ createdAt: currentTimestamp } = await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData5))
									lastEventTimestamp = currentTimestamp

									let paymentReceiptData5 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount, lastEventTimestamp)
									;({ createdAt: currentTimestamp } = await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData5))
									lastEventTimestamp = currentTimestamp

									const statusConfirmed5 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED, lastEventTimestamp)
									;({ createdAt: currentTimestamp } = await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed5))
									lastEventTimestamp = currentTimestamp
								} else {
									let paymentReqData5 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount, lastEventTimestamp)
									;({ createdAt: currentTimestamp } = await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData5))
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

	console.log('Seeding complete!')
	process.exit(0)
}

seedData().catch((error) => {
	console.error('Seeding failed:', error)
	process.exit(1)
})
