/**
 * seller-child.ts — the bidder-side child key: `derive(seller_p2pk_xpub, path)`, AUCTIONS.md §4.1/§4.2/§5.5.
 *
 * ## What this is
 *
 * AUCTIONS.md §4.1: "`p2pk_xpub`: seller HD xpub used for per-bid seller child key derivation. Bidders compute
 * `seller_child = derive(p2pk_xpub, path)`". §4.2: "`child_pubkey`: HD-derived child pubkey used **in the lock**.
 * Equals `derive(auction.p2pk_xpub, path)`." §5.5 fixes the path: "Five non-hardened levels, each a uniformly
 * random index in `[0, 0x7fffffff]` (31 bits). Total entropy ≈ 155 bits." The market's own implementation is
 * `deriveAuctionChildP2pkPubkeyFromXpub` (`market/src/lib/auctionP2pk.ts:86-94`), which uses `HDKey` from
 * `@scure/bip32`; its path generator is `generateAuctionDerivationPath` (`market/src/lib/auctionPathOracle.ts:38-41`).
 *
 * ## Why this is hand-written, and dependency-free
 *
 * The bid plugin bundle ships **zero dependencies** (measured: `plugins/bid-plugin.js` carries no
 * `secp256k1`/`sha512`/`@noble`/`@scure` markers), and the wallet bundle already carries Coco. A BIP32 public
 * child derivation needs only HMAC-SHA512 and one secp256k1 point addition per level — so it is written here as
 * plain, dependency-free TypeScript (SHA-256 for the base58check, SHA-512/HMAC-SHA512 for BIP32, the group law
 * for the tweak, base58 for the xpub) rather than pulling a dependency into either bundle. It is a pure function
 * with no network call, so it is proven **equal to the market's own function** on real vectors in
 * `seller-child.test.ts` — where importing `@scure/bip32` (the market's own library) as the oracle is allowed.
 *
 * ## References
 *
 * - BIP32 §CKDpriv/CKDpub (public child derivation: I = HMAC-SHA512(c_par, serP(K_par) || ser32(i));
 *   K_child = point(IL) + K_par; c_child = IR).
 * - FIPS 180-4 (SHA-256 / SHA-512); RFC 2104 (HMAC); secp256k1 (SEC 2).
 */

/** BIP32's hardened flag: a level ≥ this cannot be derived from a public key. */
const HARDENED = 0x80000000
/** AUCTIONS.md §5.5: five non-hardened levels, ~155 bits of entropy. */
export const AUCTION_PATH_LEVELS = 5
/** The largest non-hardened index (31 bits). */
export const AUCTION_PATH_MAX_INDEX = 0x7fffffff

const XPUB_VERSION = 0x0488b21e
const TPUB_VERSION = 0x043587cf
const XPRV_VERSION = 0x0488ade4
const TPRV_VERSION = 0x043587d2

/* --------------------------------------------------------------------------------------------------------
   SHA-256 (FIPS 180-4) — for the base58check of an xpub.
   -------------------------------------------------------------------------------------------------------- */

const K256 = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr32 = (value: number, bits: number): number => ((value >>> bits) | (value << (32 - bits))) >>> 0

/** SHA-256 over bytes, returning 32 bytes. Pure, dependency-free, and used only for base58check here. */
function sha256(bytes: Uint8Array): Uint8Array {
	const h = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	])
	const length = bytes.length
	const bitLength = BigInt(length) * 8n
	const withOne = length + 1
	const padding = ((56 - (withOne % 64)) + 64) % 64
	const total = withOne + padding + 8
	const buffer = new Uint8Array(total)
	buffer.set(bytes)
	buffer[length] = 0x80
	for (let i = 0; i < 8; i += 1) buffer[total - 1 - i] = Number((bitLength >> BigInt(8 * i)) & 0xffn)

	const w = new Uint32Array(64)
	for (let offset = 0; offset < total; offset += 64) {
		for (let i = 0; i < 16; i += 1) {
			const at = offset + i * 4
			w[i] = ((buffer[at]! << 24) | (buffer[at + 1]! << 16) | (buffer[at + 2]! << 8) | buffer[at + 3]!) >>> 0
		}
		for (let i = 16; i < 64; i += 1) {
			const s0 = rotr32(w[i - 15]!, 7) ^ rotr32(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
			const s1 = rotr32(w[i - 2]!, 17) ^ rotr32(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
			w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
		}
		let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!]
		for (let i = 0; i < 64; i += 1) {
			const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)
			const ch = (e & f) ^ (~e & g)
			const t1 = (hh + S1 + ch + K256[i]! + w[i]!) >>> 0
			const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)
			const maj = (a & b) ^ (a & c) ^ (b & c)
			const t2 = (S0 + maj) >>> 0
			hh = g
			g = f
			f = e
			e = (d + t1) >>> 0
			d = c
			c = b
			b = a
			a = (t1 + t2) >>> 0
		}
		h[0] = (h[0]! + a) >>> 0
		h[1] = (h[1]! + b) >>> 0
		h[2] = (h[2]! + c) >>> 0
		h[3] = (h[3]! + d) >>> 0
		h[4] = (h[4]! + e) >>> 0
		h[5] = (h[5]! + f) >>> 0
		h[6] = (h[6]! + g) >>> 0
		h[7] = (h[7]! + hh) >>> 0
	}
	const out = new Uint8Array(32)
	for (let i = 0; i < 8; i += 1) {
		out[i * 4] = (h[i]! >>> 24) & 0xff
		out[i * 4 + 1] = (h[i]! >>> 16) & 0xff
		out[i * 4 + 2] = (h[i]! >>> 8) & 0xff
		out[i * 4 + 3] = h[i]! & 0xff
	}
	return out
}

/* --------------------------------------------------------------------------------------------------------
   SHA-512 (FIPS 180-4) + HMAC-SHA512 (RFC 2104) — BIP32's one hash.
   -------------------------------------------------------------------------------------------------------- */

const M64 = (1n << 64n) - 1n
const rotr64 = (value: bigint, bits: bigint): bigint => ((value >> bits) | (value << (64n - bits))) & M64

const K512 = [
	0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
	0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
	0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
	0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
	0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
	0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
	0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
	0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
	0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
	0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
	0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
	0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
	0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
	0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
	0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
	0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
	0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
	0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
	0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
	0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
]

/** SHA-512 over bytes, returning 64 bytes. Pure BigInt implementation; only BIP32's HMAC uses it. */
function sha512(bytes: Uint8Array): Uint8Array {
	const h = [
		0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
		0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
	]
	const length = bytes.length
	const bitLength = BigInt(length) * 8n
	const withOne = length + 1
	const padding = ((112 - (withOne % 128)) + 128) % 128
	const total = withOne + padding + 16
	const buffer = new Uint8Array(total)
	buffer.set(bytes)
	buffer[length] = 0x80
	for (let i = 0; i < 16; i += 1) buffer[total - 1 - i] = Number((bitLength >> BigInt(8 * i)) & 0xffn)

	const w = new Array<bigint>(80)
	for (let offset = 0; offset < total; offset += 128) {
		for (let i = 0; i < 16; i += 1) {
			let value = 0n
			for (let j = 0; j < 8; j += 1) value = (value << 8n) | BigInt(buffer[offset + i * 8 + j]!)
			w[i] = value
		}
		for (let i = 16; i < 80; i += 1) {
			const s0 = rotr64(w[i - 15]!, 1n) ^ rotr64(w[i - 15]!, 8n) ^ (w[i - 15]! >> 7n)
			const s1 = rotr64(w[i - 2]!, 19n) ^ rotr64(w[i - 2]!, 61n) ^ (w[i - 2]! >> 6n)
			w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) & M64
		}
		let [a, b, c, d, e, f, g, hh] = h
		for (let i = 0; i < 80; i += 1) {
			const S1 = rotr64(e!, 14n) ^ rotr64(e!, 18n) ^ rotr64(e!, 41n)
			const ch = (e! & f!) ^ (~e! & M64 & g!)
			const t1 = (hh! + S1 + ch + K512[i]! + w[i]!) & M64
			const S0 = rotr64(a!, 28n) ^ rotr64(a!, 34n) ^ rotr64(a!, 39n)
			const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!)
			const t2 = (S0 + maj) & M64
			hh = g
			g = f
			f = e
			e = (d! + t1) & M64
			d = c
			c = b
			b = a
			a = (t1 + t2) & M64
		}
		h[0] = (h[0]! + a!) & M64
		h[1] = (h[1]! + b!) & M64
		h[2] = (h[2]! + c!) & M64
		h[3] = (h[3]! + d!) & M64
		h[4] = (h[4]! + e!) & M64
		h[5] = (h[5]! + f!) & M64
		h[6] = (h[6]! + g!) & M64
		h[7] = (h[7]! + hh!) & M64
	}
	const out = new Uint8Array(64)
	for (let i = 0; i < 8; i += 1) {
		const value = h[i]!
		for (let j = 0; j < 8; j += 1) out[i * 8 + j] = Number((value >> BigInt(8 * (7 - j))) & 0xffn)
	}
	return out
}

/** HMAC-SHA512 (RFC 2104) over a 32-byte chain code and BIP32's 37-byte data; both fit one padded block each. */
function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
	const block = new Uint8Array(128)
	block.set(key.length > 128 ? sha512(key) : key)
	const inner = new Uint8Array(block.length + data.length)
	const outer = new Uint8Array(block.length + 64)
	for (let i = 0; i < block.length; i += 1) {
		inner[i] = block[i]! ^ 0x36
		outer[i] = block[i]! ^ 0x5c
	}
	inner.set(data, block.length)
	outer.set(sha512(inner), block.length)
	return sha512(outer)
}

/* --------------------------------------------------------------------------------------------------------
   base58 (Bitcoin alphabet) — decode an xpub, checksum-verified, exactly as HDKey.fromExtendedKey does.
   -------------------------------------------------------------------------------------------------------- */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const B58_INDEX = (() => {
	const table = new Map<string, number>()
	for (let i = 0; i < B58_ALPHABET.length; i += 1) table.set(B58_ALPHABET[i]!, i)
	return table
})()

import { RefusedError } from './errors'

/** A named refusal for anything this module cannot derive from: never a silent wrong key. Carries a `code` (via
 * {@link RefusedError}) so it survives the host boundary as `refused_seller_child` rather than `adapter_failure`. */
export class SellerChildRefusedError extends RefusedError {
	readonly reason: string
	constructor(reason: string, detail: string) {
		super(`refused-seller-child: ${reason} (${detail})`)
		this.name = 'SellerChildRefusedError'
		this.reason = reason
	}
}

function base58Decode58(input: string): Uint8Array {
	let value = 0n
	for (const character of input) {
		const digit = B58_INDEX.get(character)
		if (digit === undefined) throw new SellerChildRefusedError('xpub_not_base58', 'not a base58 character: ' + character)
		value = value * 58n + BigInt(digit)
	}
	const bytes: number[] = []
	while (value > 0n) {
		bytes.unshift(Number(value & 0xffn))
		value >>= 8n
	}
	let leadingZeros = 0
	while (leadingZeros < input.length && input[leadingZeros] === '1') leadingZeros += 1
	const out = new Uint8Array(leadingZeros + bytes.length)
	out.set(bytes, leadingZeros)
	return out
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false
	for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false
	return true
}

/* --------------------------------------------------------------------------------------------------------
   secp256k1 — the group law, enough for CKDpub (one point addition per level).
   -------------------------------------------------------------------------------------------------------- */

const SECP_P = 2n ** 256n - 2n ** 32n - 977n
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n
const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n

interface Point {
	readonly x: bigint
	readonly y: bigint
}

const mod = (value: bigint, modulus: bigint): bigint => ((value % modulus) + modulus) % modulus

function powMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
	let result = 1n
	let b = mod(base, modulus)
	let e = exponent
	while (e > 0n) {
		if ((e & 1n) === 1n) result = (result * b) % modulus
		b = (b * b) % modulus
		e >>= 1n
	}
	return result
}

const inverse = (value: bigint): bigint => powMod(value, SECP_P - 2n, SECP_P)

function pointAdd(left: Point | null, right: Point | null): Point | null {
	if (left === null) return right
	if (right === null) return left
	if (left.x === right.x) {
		if ((left.y + right.y) % SECP_P === 0n) return null
		const slope = mod(3n * left.x * left.x * inverse(2n * left.y), SECP_P)
		const x = mod(slope * slope - 2n * left.x, SECP_P)
		return { x, y: mod(slope * (left.x - x) - left.y, SECP_P) }
	}
	const slope = mod((right.y - left.y) * inverse(right.x - left.x), SECP_P)
	const x = mod(slope * slope - left.x - right.x, SECP_P)
	return { x, y: mod(slope * (left.x - x) - left.y, SECP_P) }
}

function pointMultiply(scalar: bigint, point: Point): Point | null {
	let result: Point | null = null
	let addend: Point | null = point
	let k = mod(scalar, SECP_N)
	while (k > 0n) {
		if ((k & 1n) === 1n) result = pointAdd(result, addend)
		addend = pointAdd(addend, addend)
		k >>= 1n
	}
	return result
}

/** Decompress a 33-byte SEC1 public key: y² = x³ + 7, with the parity fixed by the `02`/`03` prefix. */
function decompress(compressed: Uint8Array): Point {
	if (compressed.length !== 33) throw new SellerChildRefusedError('xpub_bad_key_length', `${compressed.length} bytes, expected 33`)
	const prefix = compressed[0]!
	if (prefix !== 2 && prefix !== 3) throw new SellerChildRefusedError('xpub_bad_key_prefix', `0x${prefix.toString(16)} is not 02/03`)
	const x = bytesToBigInt(compressed.subarray(1))
	if (x >= SECP_P) throw new SellerChildRefusedError('xpub_key_off_curve', 'x is not a field element')
	const ySquared = mod(x * x * x + 7n, SECP_P)
	let y = powMod(ySquared, (SECP_P + 1n) / 4n, SECP_P)
	if (mod(y * y, SECP_P) !== ySquared) throw new SellerChildRefusedError('xpub_key_off_curve', 'x is not on secp256k1')
	if ((y & 1n) !== BigInt(prefix & 1)) y = SECP_P - y
	return { x, y }
}

function pointToCompressed(point: Point): Uint8Array {
	const out = new Uint8Array(33)
	out[0] = (point.y & 1n) === 0n ? 2 : 3
	out.set(bigIntToBytes(point.x, 32), 1)
	return out
}

function bytesToBigInt(bytes: Uint8Array): bigint {
	let value = 0n
	for (const byte of bytes) value = (value << 8n) | BigInt(byte)
	return value
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
	const out = new Uint8Array(length)
	let remaining = value
	for (let i = length - 1; i >= 0; i -= 1) {
		out[i] = Number(remaining & 0xffn)
		remaining >>= 8n
	}
	return out
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/* --------------------------------------------------------------------------------------------------------
   The public surface.
   -------------------------------------------------------------------------------------------------------- */

/** An xpub's two derivation inputs: the chain code and the compressed public key. */
interface ExtendedPublicKey {
	readonly chainCode: Uint8Array
	readonly publicKey: Uint8Array
}

/**
 * Parse and checksum-verify an extended public key (base58check, 78 payload bytes).
 *
 * Refuses **by name** on any malformed input, and refuses a **private** extended key outright: a seller publishes
 * an `xpub`, and deriving from a leaked `xprv` here would be a mistake this module will not make silently.
 */
export function parseExtendedPublicKey(xpub: string): ExtendedPublicKey {
	const trimmed = (xpub ?? '').trim()
	if (trimmed.length === 0) throw new SellerChildRefusedError('xpub_missing', 'the auction named no p2pk_xpub')
	const decoded = base58Decode58(trimmed)
	if (decoded.length !== 82) throw new SellerChildRefusedError('xpub_bad_length', `${decoded.length} base58-decoded bytes, expected 82`)
	const payload = decoded.subarray(0, 78)
	const checksum = decoded.subarray(78)
	const expected = sha256(sha256(payload)).subarray(0, 4)
	if (!equalBytes(checksum, expected)) throw new SellerChildRefusedError('xpub_bad_checksum', 'the base58check checksum does not match')
	const version = Number((BigInt(payload[0]!) << 24n) | (BigInt(payload[1]!) << 16n) | (BigInt(payload[2]!) << 8n) | BigInt(payload[3]!))
	if (version === XPRV_VERSION || version === TPRV_VERSION) {
		throw new SellerChildRefusedError('xpub_is_private', 'the auction published an extended PRIVATE key, not an xpub')
	}
	if (version !== XPUB_VERSION && version !== TPUB_VERSION) {
		throw new SellerChildRefusedError('xpub_bad_version', `0x${version.toString(16).padStart(8, '0')} is neither xpub nor tpub`)
	}
	return { chainCode: payload.subarray(13, 45), publicKey: payload.subarray(45, 78) }
}

/** Normalize a path to `m/a/b/...`, refusing hardened levels (a public xpub cannot derive one). */
export function normalizeBidPath(path: string): number[] {
	const trimmed = (path ?? '').trim()
	if (trimmed.length === 0) throw new SellerChildRefusedError('path_missing', 'no derivation path was given')
	const body = trimmed.replace(/^[mM]\//, '')
	if (body === trimmed) {
		// Accept a bare `a/b/c` too, exactly as the market's `normalizeAuctionDerivationPath` does.
		if (!/^[0-9]/.test(trimmed)) throw new SellerChildRefusedError('path_malformed', 'not a BIP32 path: ' + trimmed)
	}
	const segments = body.split('/')
	if (segments.length !== AUCTION_PATH_LEVELS || segments.some((segment) => segment.length === 0)) {
		throw new SellerChildRefusedError('path_depth_invalid', `auction paths require exactly ${AUCTION_PATH_LEVELS} non-empty levels`)
	}
	const indices: number[] = []
	for (const segment of segments) {
		if (/['hH]$/.test(segment)) {
			throw new SellerChildRefusedError('path_hardened', 'a hardened level cannot be derived from a public xpub: ' + segment)
		}
		if (!/^[0-9]+$/.test(segment)) throw new SellerChildRefusedError('path_malformed', 'not a non-hardened index: ' + segment)
		const index = Number.parseInt(segment, 10)
		if (!Number.isSafeInteger(index) || index >= HARDENED) {
			throw new SellerChildRefusedError('path_index_out_of_range', 'at or beyond the hardened flag: ' + segment)
		}
		indices.push(index)
	}
	return indices
}

/** One BIP32 public child derivation (CKDpub): I = HMAC-SHA512(c_par, serP(K_par) || ser32(i)). */
export function deriveChildPublicKey(parent: ExtendedPublicKey, index: number): ExtendedPublicKey {
	if (index < 0 || index >= HARDENED) throw new SellerChildRefusedError('path_index_out_of_range', `${index} is not a non-hardened index`)
	const parentPoint = decompress(parent.publicKey)
	const data = new Uint8Array(37)
	data.set(parent.publicKey, 0)
	data.set(bigIntToBytes(BigInt(index), 4), 33)
	const i = hmacSha512(parent.chainCode, data)
	const tweak = bytesToBigInt(i.subarray(0, 32))
	if (tweak >= SECP_N) throw new SellerChildRefusedError('child_tweak_out_of_range', 'IL is not a valid scalar')
	const tweakPoint = pointMultiply(tweak, { x: SECP_GX, y: SECP_GY })
	const child = pointAdd(tweakPoint, parentPoint)
	if (child === null) throw new SellerChildRefusedError('child_point_at_infinity', 'the derived child is the point at infinity')
	return { chainCode: i.subarray(32, 64), publicKey: pointToCompressed(child) }
}

/**
 * `derive(auction.p2pk_xpub, path)` — the key the lock's `data` must equal (AUCTIONS.md §4.2, ADR-0003 P3.9).
 *
 * Returns the child pubkey in the **compressed** 33-byte form NUT-11's `data` carries (66 hex chars), which is
 * what `validateAuctionP2pkPubkey` returns and what the market's own function returns.
 */
export function deriveSellerChildPubkey(xpub: string, path: string): string {
	let current = parseExtendedPublicKey(xpub)
	for (const index of normalizeBidPath(path)) current = deriveChildPublicKey(current, index)
	return toHex(current.publicKey)
}

/**
 * A fresh bidder-chosen derivation path: `AUCTION_PATH_LEVELS` non-hardened levels, each a uniformly random
 * 31-bit index (AUCTIONS.md §5.5, ≈155 bits of entropy). Mirrors the market's `generateAuctionDerivationPath`.
 */
export function generateBidDerivationPath(): string {
	const levels: number[] = []
	const random = (globalThis as { crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array } }).crypto
	if (typeof random?.getRandomValues !== 'function') {
		throw new SellerChildRefusedError('secure_random_unavailable', 'auction paths require crypto.getRandomValues')
	}
	for (let i = 0; i < AUCTION_PATH_LEVELS; i += 1) {
		const buffer = new Uint32Array(1)
		random.getRandomValues(buffer)
		levels.push(buffer[0]! & AUCTION_PATH_MAX_INDEX)
	}
	return `m/${levels.join('/')}`
}
