import { HDKey } from '@scure/bip32'

// Frozen software identity (ADR-018): an input to auction HD key derivation,
// not an instance-branding string. Changing it changes every derived auction
// key, so it must stay identical across every deployment/fork rather than
// resolve from instance config.
export const AUCTION_HD_ROOT_CONTEXT = 'plebeian.market:auction-hd-root:v1'
export const AUCTION_HD_ACCOUNT_PATH = "m/30408'/0'/0'"

const sha512Bytes = async (value: string): Promise<Uint8Array> => {
	if (!globalThis.crypto?.subtle) {
		throw new Error('Secure crypto support is required for auction HD keys')
	}

	const encoded = new TextEncoder().encode(value)
	const digest = await globalThis.crypto.subtle.digest('SHA-512', encoded)
	return new Uint8Array(digest)
}

export const getAuctionHdAccountFromWalletKeys = async (walletP2pk: string, walletPrivkey: string): Promise<HDKey> => {
	const seed = await sha512Bytes(`${AUCTION_HD_ROOT_CONTEXT}:${walletP2pk}:${walletPrivkey}`)
	return HDKey.fromMasterSeed(seed).derive(AUCTION_HD_ACCOUNT_PATH)
}

export const getAuctionXpubFromWalletKeys = async (walletP2pk: string, walletPrivkey: string): Promise<string> => {
	const account = await getAuctionHdAccountFromWalletKeys(walletP2pk, walletPrivkey)
	const xpub = account.publicExtendedKey

	if (!xpub) {
		throw new Error('Failed to derive auction hd xpub')
	}

	return xpub
}
