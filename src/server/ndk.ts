import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { APP_PRIVATE_KEY, RELAY_URL } from './runtime'

/**
 * Module-level singletons for the issuer's NDK + signer.
 *
 * The issuer process owns one NDK instance pointed at the configured app
 * relay (`APP_RELAY_URL`) and one Nostr signer derived from
 * `APP_PRIVATE_KEY`. Both are lazy — first call creates and connects them.
 */

let invoiceNdk: NDK | null = null
let invoiceNdkConnectPromise: Promise<void> | null = null
let appAuctionSigner: NDKPrivateKeySigner | null = null

export async function ensureInvoiceNdkConnected(): Promise<NDK> {
	if (!RELAY_URL) {
		throw new Error('Missing APP_RELAY_URL')
	}
	if (!invoiceNdk) {
		invoiceNdk = new NDK({ explicitRelayUrls: [RELAY_URL] })
	}
	if (!invoiceNdkConnectPromise) {
		invoiceNdkConnectPromise = invoiceNdk.connect().catch((error) => {
			invoiceNdkConnectPromise = null
			throw error
		})
	}
	await invoiceNdkConnectPromise
	return invoiceNdk
}

export async function getAppAuctionSigner(): Promise<NDKPrivateKeySigner> {
	if (appAuctionSigner) return appAuctionSigner
	if (!APP_PRIVATE_KEY) throw new Error('Missing APP_PRIVATE_KEY')
	appAuctionSigner = new NDKPrivateKeySigner(APP_PRIVATE_KEY)
	await appAuctionSigner.blockUntilReady()
	return appAuctionSigner
}
