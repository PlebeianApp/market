import type { PaymentDetailsMethod } from '@/lib/constants'
import { PAYMENT_DETAILS_METHOD } from '@/lib/constants'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, NDKKind, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { nip04, nip19 } from 'nostr-tools'

/**
 * Converts a public key to hex format if it's in npub format
 */
function ensureHexPubkey(pubkey: string | undefined): string {
	if (!pubkey) {
		throw new Error('Public key is undefined or empty')
	}

	// If it starts with npub, decode it
	if (pubkey.startsWith('npub')) {
		const decoded = nip19.decode(pubkey)
		if (decoded.type === 'npub') {
			return decoded.data
		}
	}
	// If it's already hex (64 characters), return as-is
	if (/^[a-f0-9]{64}$/i.test(pubkey)) {
		return pubkey
	}
	throw new Error(`Invalid public key format: ${pubkey}`)
}

export interface PaymentDetailData {
	id: string
	paymentMethod: PaymentDetailsMethod
	paymentDetail: string
	stallId: string | null
	stallName: string
	isDefault: boolean
	createdAt: number
}

export type PaymentScope = 'global' | 'collection' | 'products'

export interface PaymentDetailOptions {
	lightningAddress: string
	scope?: PaymentScope
	coordinates?: string[] // Array of 'a' tag coordinates (e.g., ['30402:pubkey:dtag1', '30402:pubkey:dtag2'])
	scopeName?: string
}

/**
 * Generate a Lightning payment detail with scope support
 * @param options - Payment detail configuration including scope
 */
export function generateLightningPaymentDetail(options: PaymentDetailOptions): Omit<PaymentDetailData, 'id' | 'createdAt'> & {
	tags: NDKTag[]
	coordinates?: string[]
} {
	const { lightningAddress, scope = 'global', coordinates = [], scopeName = 'General' } = options

	return {
		paymentMethod: PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK,
		paymentDetail: lightningAddress,
		stallId: null,
		stallName: scopeName,
		isDefault: scope === 'global', // Global wallets are default
		coordinates,
		tags: [
			['d', faker.string.alphanumeric(16)], // Unique identifier
			['method', PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK],
			['details', lightningAddress],
			['stall_id', ''],
			['stall_name', scopeName],
			['is_default', scope === 'global' ? 'true' : 'false'],
		] as NDKTag[],
	}
}

/**
 * Generate an on-chain payment detail with scope support
 * @param options - Payment detail configuration including scope
 */
export function generateOnChainPaymentDetail(options: {
	xpub: string
	scope?: PaymentScope
	coordinates?: string[]
	scopeName?: string
}): Omit<PaymentDetailData, 'id' | 'createdAt'> & {
	tags: NDKTag[]
	coordinates?: string[]
} {
	const { xpub, scope = 'global', coordinates = [], scopeName = 'General' } = options

	return {
		paymentMethod: PAYMENT_DETAILS_METHOD.ON_CHAIN,
		paymentDetail: xpub,
		stallId: null,
		stallName: scopeName,
		isDefault: scope === 'global',
		coordinates,
		tags: [
			['d', faker.string.alphanumeric(16)], // Unique identifier
			['method', PAYMENT_DETAILS_METHOD.ON_CHAIN],
			['details', xpub],
			['stall_id', ''],
			['stall_name', scopeName],
			['is_default', scope === 'global' ? 'true' : 'false'],
		] as NDKTag[],
	}
}

export async function createPaymentDetailEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	paymentDetailData: ReturnType<typeof generateLightningPaymentDetail> | ReturnType<typeof generateOnChainPaymentDetail>,
	appPubkey: string | undefined,
) {
	const event = new NDKEvent(ndk)
	event.kind = NDKKind.AppSpecificData

	// Get user pubkey from signer
	const user = await signer.user()
	if (!user) throw new Error('Unable to get user from signer')

	// Create the content to encrypt
	const content = JSON.stringify({
		payment_method: paymentDetailData.paymentMethod,
		payment_detail: paymentDetailData.paymentDetail,
		stall_id: paymentDetailData.stallId,
		stall_name: paymentDetailData.stallName,
		is_default: paymentDetailData.isDefault,
	})

	// Convert keys to hex format
	const hexAppPubkey = ensureHexPubkey(appPubkey)
	const hexUserPubkey = ensureHexPubkey(user.pubkey)

	// Encrypt the content using NIP-04
	try {
		event.content = await nip04.encrypt(hexUserPubkey, hexAppPubkey, content)
	} catch (error) {
		console.error('Failed to encrypt payment details:', error)
		console.error('App pubkey:', appPubkey)
		console.error('User pubkey:', user.pubkey)
		throw error
	}

	// Set the required tags
	event.tags = [
		['l', 'payment_detail'], // Label tag required by the queries
		['p', hexAppPubkey], // App pubkey for decryption (in hex format)
		...paymentDetailData.tags.filter((tag) => tag[0] === 'd'), // Keep the 'd' tag for unique identifier
	]

	// Add 'a' tags for coordinates (product/collection scoping)
	if (paymentDetailData.coordinates && paymentDetailData.coordinates.length > 0) {
		for (const coordinate of paymentDetailData.coordinates) {
			event.tags.push(['a', coordinate])
		}
	}

	event.created_at = Math.floor(Date.now() / 1000)

	try {
		await event.sign(signer)
		await event.publish()

		// Enhanced logging
		const scopeInfo =
			paymentDetailData.coordinates && paymentDetailData.coordinates.length > 0
				? `scoped to ${paymentDetailData.coordinates.length} coordinate(s)`
				: 'global scope'
		console.log(
			`✅ Published payment detail: ${paymentDetailData.paymentMethod} - ${paymentDetailData.paymentDetail.substring(0, 30)}... (${scopeInfo})`,
		)

		return true
	} catch (error) {
		console.error(`❌ Failed to publish payment detail`, error)
		return false
	}
}

/**
 * Helper function to create multiple payment details for testing different scopes
 * @param signer - NDK private key signer
 * @param ndk - NDK instance
 * @param appPubkey - App pubkey for encryption
 * @param lightningAddress - Lightning address to use for all wallets
 * @param productCoordinates - Array of product coordinates (e.g., ['30402:pubkey:dtag1', '30402:pubkey:dtag2'])
 * @param collectionCoordinates - Array of collection coordinates (e.g., ['30405:pubkey:dtag1'])
 */
export async function seedMultiplePaymentDetails(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	appPubkey: string | undefined,
	lightningAddress: string,
	productCoordinates: string[] = [],
	collectionCoordinates: string[] = [],
) {
	console.log('\n🌱 Seeding multiple payment details for testing...')
	console.log(`Lightning Address: ${lightningAddress}`)
	console.log(`Products: ${productCoordinates.length}`)
	console.log(`Collections: ${collectionCoordinates.length}`)

	const results: boolean[] = []

	// 1. Create a GLOBAL wallet (applies to all products)
	console.log('\n1️⃣ Creating GLOBAL wallet...')
	const globalWallet = generateLightningPaymentDetail({
		lightningAddress,
		scope: 'global',
		scopeName: 'Global Wallet',
	})
	results.push(await createPaymentDetailEvent(signer, ndk, globalWallet, appPubkey))

	// 2. Create COLLECTION-SPECIFIC wallets (if collections provided)
	if (collectionCoordinates.length > 0) {
		console.log('\n2️⃣ Creating COLLECTION-SPECIFIC wallets...')
		for (let i = 0; i < collectionCoordinates.length; i++) {
			const collectionWallet = generateLightningPaymentDetail({
				lightningAddress,
				scope: 'collection',
				coordinates: [collectionCoordinates[i]],
				scopeName: `Collection Wallet ${i + 1}`,
			})
			results.push(await createPaymentDetailEvent(signer, ndk, collectionWallet, appPubkey))
		}
	}

	// 3. Create PRODUCT-SPECIFIC wallets
	if (productCoordinates.length > 0) {
		console.log('\n3️⃣ Creating PRODUCT-SPECIFIC wallets...')

		// Single product wallet
		if (productCoordinates.length >= 1) {
			const singleProductWallet = generateLightningPaymentDetail({
				lightningAddress,
				scope: 'products',
				coordinates: [productCoordinates[0]],
				scopeName: 'Product 1 Wallet',
			})
			results.push(await createPaymentDetailEvent(signer, ndk, singleProductWallet, appPubkey))
		}

		// Multi-product wallet (2-3 products)
		if (productCoordinates.length >= 3) {
			const multiProductWallet = generateLightningPaymentDetail({
				lightningAddress,
				scope: 'products',
				coordinates: [productCoordinates[1], productCoordinates[2]],
				scopeName: 'Products 2-3 Wallet',
			})
			results.push(await createPaymentDetailEvent(signer, ndk, multiProductWallet, appPubkey))
		}

		// Another multi-product wallet (if more products available)
		if (productCoordinates.length >= 5) {
			const anotherMultiProductWallet = generateLightningPaymentDetail({
				lightningAddress,
				scope: 'products',
				coordinates: [productCoordinates[3], productCoordinates[4]],
				scopeName: 'Products 4-5 Wallet',
			})
			results.push(await createPaymentDetailEvent(signer, ndk, anotherMultiProductWallet, appPubkey))
		}
	}

	const successCount = results.filter(Boolean).length
	console.log(`\n✨ Seeding complete: ${successCount}/${results.length} payment details created`)

	return successCount === results.length
}

/**
 * Example usage for seeding payment details:
 *
 * ```typescript
 * import { seedMultiplePaymentDetails } from './gen_payment_details'
 *
 * // Example with product and collection coordinates
 * const sellerPubkey = 'your-seller-pubkey'
 * const lightningAddress = 'seller@getalby.com'
 *
 * // Get your product coordinates (from your products)
 * const productCoordinates = [
 *   `30402:${sellerPubkey}:product-dtag-1`,
 *   `30402:${sellerPubkey}:product-dtag-2`,
 *   `30402:${sellerPubkey}:product-dtag-3`,
 *   `30402:${sellerPubkey}:product-dtag-4`,
 *   `30402:${sellerPubkey}:product-dtag-5`,
 * ]
 *
 * // Get your collection coordinates (from your collections)
 * const collectionCoordinates = [
 *   `30405:${sellerPubkey}:collection-dtag-1`,
 *   `30405:${sellerPubkey}:collection-dtag-2`,
 * ]
 *
 * await seedMultiplePaymentDetails(
 *   signer,
 *   ndk,
 *   appPubkey,
 *   lightningAddress,
 *   productCoordinates,
 *   collectionCoordinates
 * )
 *
 * // This will create:
 * // - 1 global wallet (applies to all products)
 * // - 2 collection-specific wallets (one per collection)
 * // - 3 product-specific wallets:
 * //   - Single product wallet (product 1)
 * //   - Multi-product wallet (products 2-3)
 * //   - Multi-product wallet (products 4-5)
 * // Total: 6 payment details
 * ```
 */
