import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import {
	auctionP2pkPubkeysMatch,
	deriveAuctionChildP2pkPubkeyFromXpub,
	normalizeAuctionDerivationPath,
	normalizeAuctionP2pkPubkey,
	toCompressedAuctionP2pkPubkey,
} from '@/lib/auctionP2pk'

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

describe('auctionP2pk', () => {
	test('normalizeAuctionP2pkPubkey accepts x-only and compressed forms', () => {
		const compressed = '03b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'
		const xOnly = 'b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'

		expect(normalizeAuctionP2pkPubkey(xOnly)).toBe(xOnly)
		expect(normalizeAuctionP2pkPubkey(compressed)).toBe(xOnly)
		expect(auctionP2pkPubkeysMatch(compressed, xOnly)).toBe(true)
	})

	test('deriveAuctionChildP2pkPubkeyFromXpub returns compressed secp256k1 pubkeys', () => {
		const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
		const account = HDKey.fromMasterSeed(seed).derive("m/30408'/0'/0'")
		const xpub = account.publicExtendedKey
		if (!xpub) {
			throw new Error('Failed to derive test xpub')
		}

		const derivationPath = normalizeAuctionDerivationPath('7/11/13')
		const child = account.derive(derivationPath)
		if (!child.publicKey) {
			throw new Error('Failed to derive test child pubkey')
		}

		const compressedChildPubkey = toHex(child.publicKey)
		const derivedChildPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, derivationPath)

		expect(derivedChildPubkey).toBe(compressedChildPubkey)
		expect(derivedChildPubkey).toHaveLength(66)
	})

	test('normalizeAuctionP2pkPubkey rejects invalid encodings', () => {
		expect(() => normalizeAuctionP2pkPubkey('zz')).toThrow('hex encoded')
		expect(() => normalizeAuctionP2pkPubkey('04deadbeef')).toThrow('x-only or compressed')
	})

	test('toCompressedAuctionP2pkPubkey preserves compressed form and rejects x-only', () => {
		const compressed02 = '02b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'
		const compressed03 = '03b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'
		const xOnly = 'b72fc0f74836f2066957875bc0e48c6fe734f537117c8fc80d4a365a84f31712'

		expect(toCompressedAuctionP2pkPubkey(compressed02)).toBe(compressed02)
		expect(toCompressedAuctionP2pkPubkey(compressed03)).toBe(compressed03)
		expect(toCompressedAuctionP2pkPubkey(compressed03.toUpperCase())).toBe(compressed03)

		// Regression: a bare x-only nostr identity pubkey must NOT be silently accepted as a
		// Cashu P2PK lock pubkey. Mints require compressed secp256k1 and fail to parse x-only.
		expect(() => toCompressedAuctionP2pkPubkey(xOnly)).toThrow('compressed')
		expect(() => toCompressedAuctionP2pkPubkey('')).toThrow('Missing')
		expect(() => toCompressedAuctionP2pkPubkey('zz')).toThrow('hex encoded')
		expect(() => toCompressedAuctionP2pkPubkey('04' + xOnly + 'ff'.repeat(32))).toThrow('compressed')
	})
})
