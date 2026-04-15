import { HDKey } from '@scure/bip32'

const P2PK_XONLY_HEX_LENGTH = 64
const P2PK_COMPRESSED_HEX_LENGTH = 66

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

export const normalizeAuctionDerivationPath = (path: string): string => {
	const trimmed = path.trim()
	if (!trimmed) {
		throw new Error('Missing derivation path')
	}
	return trimmed.startsWith('m/') || trimmed === 'm' ? trimmed : `m/${trimmed.replace(/^\/+/, '')}`
}

export const normalizeAuctionP2pkPubkey = (pubkey: string): string => {
	const trimmed = pubkey.trim().toLowerCase()
	if (!trimmed) {
		throw new Error('Missing P2PK pubkey')
	}
	if (!/^[0-9a-f]+$/.test(trimmed)) {
		throw new Error('P2PK pubkey must be hex encoded')
	}
	if (trimmed.length === P2PK_XONLY_HEX_LENGTH) {
		return trimmed
	}
	if (trimmed.length === P2PK_COMPRESSED_HEX_LENGTH && (trimmed.startsWith('02') || trimmed.startsWith('03'))) {
		return trimmed.slice(2)
	}
	throw new Error('P2PK pubkey must be x-only or compressed secp256k1 hex')
}

export const validateAuctionP2pkPubkey = (pubkey: string): string => {
	const trimmed = pubkey.trim().toLowerCase()
	normalizeAuctionP2pkPubkey(trimmed)
	return trimmed
}

export const toCompressedAuctionP2pkPubkey = (pubkey: string): string => {
	const trimmed = pubkey.trim().toLowerCase()
	if (!trimmed) {
		throw new Error('Missing P2PK pubkey')
	}
	if (!/^[0-9a-f]+$/.test(trimmed)) {
		throw new Error('P2PK pubkey must be hex encoded')
	}
	if (trimmed.length === P2PK_COMPRESSED_HEX_LENGTH && (trimmed.startsWith('02') || trimmed.startsWith('03'))) {
		return trimmed
	}
	if (trimmed.length === P2PK_XONLY_HEX_LENGTH) {
		throw new Error('Cashu P2PK pubkey must be compressed secp256k1 (66 hex chars with 02/03 prefix); received x-only form')
	}
	throw new Error('P2PK pubkey must be compressed secp256k1 hex (66 chars, 02/03 prefix)')
}

export const auctionP2pkPubkeysMatch = (left: string, right: string): boolean =>
	normalizeAuctionP2pkPubkey(left) === normalizeAuctionP2pkPubkey(right)

export const deriveAuctionChildP2pkPubkeyFromXpub = (xpub: string, path: string): string => {
	const hdRoot = HDKey.fromExtendedKey(xpub.trim())
	const child = hdRoot.derive(normalizeAuctionDerivationPath(path))
	if (!child.publicKey) {
		throw new Error('Failed to derive child pubkey from p2pk_xpub')
	}

	return validateAuctionP2pkPubkey(toHex(child.publicKey))
}
