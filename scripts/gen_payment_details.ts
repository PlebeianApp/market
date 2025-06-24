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

export function generateLightningPaymentDetail(lightningAddress: string): Omit<PaymentDetailData, 'id' | 'createdAt'> & { tags: NDKTag[] } {
	return {
		paymentMethod: PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK,
		paymentDetail: lightningAddress,
		stallId: null,
		stallName: 'General',
		isDefault: false,
		tags: [
			['d', faker.string.alphanumeric(16)], // Unique identifier
			['method', PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK],
			['details', lightningAddress],
			['stall_id', ''],
			['stall_name', 'General'],
			['is_default', 'false'],
		] as NDKTag[],
	}
}

export function generateOnChainPaymentDetail(xpub: string): Omit<PaymentDetailData, 'id' | 'createdAt'> & { tags: NDKTag[] } {
	return {
		paymentMethod: PAYMENT_DETAILS_METHOD.ON_CHAIN,
		paymentDetail: xpub,
		stallId: null,
		stallName: 'General',
		isDefault: true, // Make on-chain the default
		tags: [
			['d', faker.string.alphanumeric(16)], // Unique identifier
			['method', PAYMENT_DETAILS_METHOD.ON_CHAIN],
			['details', xpub],
			['stall_id', ''],
			['stall_name', 'General'],
			['is_default', 'true'],
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
	event.created_at = Math.floor(Date.now() / 1000)

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published payment detail: ${paymentDetailData.paymentMethod} - ${paymentDetailData.paymentDetail.substring(0, 20)}...`)
		return true
	} catch (error) {
		console.error(`Failed to publish payment detail`, error)
		return false
	}
}
