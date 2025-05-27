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
} from './gen_orders'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

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

				// Create order (buyer to merchant)
				const orderData = generateOrderCreationData(buyerPubkey, sellerPubkey, productRef)
				const orderEventId = await createOrderEvent(buyerSigner, ndk, orderData)

				if (orderEventId) {
					// Get order id from tags
					const orderId = orderData.tags.find((tag) => tag[0] === 'order')?.[1]
					const totalAmount = orderData.tags.find((tag) => tag[0] === 'amount')?.[1] || '0'

					if (orderId) {
						// Create different status flows based on order number to show full spectrum
						switch (i) {
							case 0:
								// PENDING state: Just create the order with no further updates
								console.log(`    Order ${i + 1}: PENDING state (awaiting payment)`)

								// Just create a payment request without receipt or status updates
								const paymentRequestData = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
								await createPaymentRequestEvent(sellerSigner, ndk, paymentRequestData)
								break

							case 1:
								// CONFIRMED state: Order with payment and confirmation
								console.log(`    Order ${i + 1}: CONFIRMED state`)

								// Create payment request and receipt
								const paymentReqData = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
								await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData)

								const paymentReceiptData = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount)
								await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData)

								// Confirm the order
								const statusConfirmed = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
								await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed)
								break

							case 2:
								// PROCESSING state: Confirmed and now processing
								console.log(`    Order ${i + 1}: PROCESSING state`)

								// Create payment request and receipt
								const paymentReqData2 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
								await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData2)

								const paymentReceiptData2 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount)
								await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData2)

								// Confirm and then process the order
								const statusConfirmed2 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
								await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed2)

								const statusProcessing = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING)
								await createOrderStatusEvent(sellerSigner, ndk, statusProcessing)
								break

							case 3:
								// SHIPPED state: Processing with shipping update
								console.log(`    Order ${i + 1}: SHIPPED state (processing + shipping)`)

								// Create payment request and receipt
								const paymentReqData3 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
								await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData3)

								const paymentReceiptData3 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount)
								await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData3)

								// Confirm and then process the order
								const statusConfirmed3 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
								await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed3)

								const statusProcessing2 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING)
								await createOrderStatusEvent(sellerSigner, ndk, statusProcessing2)

								// Add shipping update
								const shippingData = generateShippingUpdateData(buyerPubkey, orderId, SHIPPING_STATUS.SHIPPED)
								await createShippingUpdateEvent(sellerSigner, ndk, shippingData)
								break

							case 4:
								// COMPLETED state: Full order flow to completion
								console.log(`    Order ${i + 1}: COMPLETED state`)

								// Create payment request and receipt
								const paymentReqData4 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
								await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData4)

								const paymentReceiptData4 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount)
								await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData4)

								// Complete order flow
								const statusConfirmed4 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
								await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed4)

								const statusProcessing3 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING)
								await createOrderStatusEvent(sellerSigner, ndk, statusProcessing3)

								const shippingData2 = generateShippingUpdateData(buyerPubkey, orderId, SHIPPING_STATUS.SHIPPED)
								await createShippingUpdateEvent(sellerSigner, ndk, shippingData2)

								const statusCompleted = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.COMPLETED)
								await createOrderStatusEvent(sellerSigner, ndk, statusCompleted)
								break

							case 5:
								// CANCELLED state: Order that got cancelled
								console.log(`    Order ${i + 1}: CANCELLED state`)

								// Randomly choose when the cancellation happens
								const cancelStage = Math.floor(Math.random() * 3) // 0: pending, 1: confirmed, 2: processing

								if (cancelStage >= 1) {
									// Create payment request and receipt
									const paymentReqData5 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
									await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData5)

									const paymentReceiptData5 = generatePaymentReceiptData(sellerPubkey, orderId, totalAmount)
									await createPaymentReceiptEvent(buyerSigner, ndk, paymentReceiptData5)

									// Add confirmation
									const statusConfirmed5 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.CONFIRMED)
									await createOrderStatusEvent(sellerSigner, ndk, statusConfirmed5)
								} else {
									// Just create a payment request for pending orders
									const paymentReqData5 = generatePaymentRequestData(buyerPubkey, orderId, totalAmount)
									await createPaymentRequestEvent(sellerSigner, ndk, paymentReqData5)
								}

								if (cancelStage >= 2) {
									// Add processing state before cancellation
									const statusProcessing4 = generateOrderStatusData(buyerPubkey, orderId, ORDER_STATUS.PROCESSING)
									await createOrderStatusEvent(sellerSigner, ndk, statusProcessing4)
								}

								// Finally cancel the order
								// Randomize who cancels (buyer or seller)
								const isBuyerCancelling = Math.random() > 0.5
								const canceller = isBuyerCancelling ? buyerSigner : sellerSigner
								const recipient = isBuyerCancelling ? sellerPubkey : buyerPubkey

								const statusCancelled = generateOrderStatusData(recipient, orderId, ORDER_STATUS.CANCELLED)
								await createOrderStatusEvent(canceller, ndk, statusCancelled)
								break

							default:
								// Shouldn't reach here with our setup
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
