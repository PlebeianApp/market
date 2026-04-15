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

export const inspectAuctionP2pkPubkey = (
	pubkey?: string | null,
): {
	value: string
	length: number
	format: 'missing' | 'x-only' | 'compressed' | 'invalid'
	normalized?: string
	error?: string
} => {
	const value = pubkey?.trim() ?? ''
	if (!value) {
		return { value: '', length: 0, format: 'missing' }
	}

	if (value.length === P2PK_XONLY_HEX_LENGTH) {
		return {
			value,
			length: value.length,
			format: 'x-only',
			normalized: value.toLowerCase(),
		}
	}

	if (value.length === P2PK_COMPRESSED_HEX_LENGTH && (value.startsWith('02') || value.startsWith('03'))) {
		return {
			value,
			length: value.length,
			format: 'compressed',
			normalized: value.slice(2).toLowerCase(),
		}
	}

	try {
		return {
			value,
			length: value.length,
			format: 'invalid',
			normalized: normalizeAuctionP2pkPubkey(value),
		}
	} catch (error) {
		return {
			value,
			length: value.length,
			format: 'invalid',
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export const inspectAuctionP2pkSecret = (secret: string): Record<string, unknown> => {
	try {
		const parsed = JSON.parse(secret)
		if (!Array.isArray(parsed) || parsed[0] !== 'P2PK' || typeof parsed[1] !== 'object' || parsed[1] === null) {
			return { kind: 'unknown', secretPreview: secret.slice(0, 120) }
		}

		const data = parsed[1] as { data?: string; tags?: unknown }
		const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string[] => Array.isArray(tag)) : []
		const pubkeysTag = tags.find((tag) => tag[0] === 'pubkeys')
		const refundTag = tags.find((tag) => tag[0] === 'refund')
		const locktimeTag = tags.find((tag) => tag[0] === 'locktime')
		const nSigsTag = tags.find((tag) => tag[0] === 'n_sigs')
		const nSigsRefundTag = tags.find((tag) => tag[0] === 'n_sigs_refund')
		const sigflagTag = tags.find((tag) => tag[0] === 'sigflag')

		return {
			kind: 'P2PK',
			data: inspectAuctionP2pkPubkey(typeof data.data === 'string' ? data.data : ''),
			pubkeys: (pubkeysTag?.slice(1) ?? []).map((pubkey) => inspectAuctionP2pkPubkey(pubkey)),
			refundKeys: (refundTag?.slice(1) ?? []).map((pubkey) => inspectAuctionP2pkPubkey(pubkey)),
			locktime: locktimeTag?.[1] ?? null,
			nSigs: nSigsTag?.[1] ?? null,
			nSigsRefund: nSigsRefundTag?.[1] ?? null,
			sigflag: sigflagTag?.[1] ?? null,
		}
	} catch (error) {
		return {
			kind: 'invalid',
			error: error instanceof Error ? error.message : String(error),
			secretPreview: secret.slice(0, 120),
		}
	}
}

export const deriveAuctionChildP2pkPubkeyFromXpub = (xpub: string, path: string): string => {
	const hdRoot = HDKey.fromExtendedKey(xpub.trim())
	const child = hdRoot.derive(normalizeAuctionDerivationPath(path))
	if (!child.publicKey) {
		throw new Error('Failed to derive child pubkey from p2pk_xpub')
	}

	return validateAuctionP2pkPubkey(toHex(child.publicKey))
}
