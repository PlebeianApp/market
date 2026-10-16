/**
 * NUT-00 `hash_to_curve` — derives the `Y = hash_to_curve(secret)` value
 * Cashu mints use as the lookup key for proof-state queries (NUT-7) and
 * blind-signature operations.
 *
 * cashu-ts exports this internally but doesn't re-export it from its
 * public surface (as of 2.9.x), so we reimplement it here. The algorithm
 * is well-defined and unambiguous — see
 * https://github.com/cashubtc/nuts/blob/main/00.md#hash_to_curve.
 *
 * Algorithm:
 *
 *   1. msg_hash = sha256(DOMAIN_SEPARATOR || secret_bytes)
 *   2. counter = 0
 *   3. loop:
 *        candidate_x = sha256(msg_hash || counter_as_4_byte_little_endian)
 *        try to decompress as compressed secp256k1 point with prefix 02
 *        if valid: return the point (or its compressed serialisation)
 *        else: counter += 1
 *
 * `counter` virtually never exceeds a handful (~50% hit rate per attempt
 * since roughly half of x-coordinates yield valid points), so this
 * terminates fast in practice. We cap iterations defensively to avoid an
 * infinite loop on pathological inputs.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { ProjectivePoint } from '@noble/secp256k1'

/** NUT-00 domain separator, encoded as UTF-8 bytes (28 chars). */
const DOMAIN_SEPARATOR = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_')

/** Defensive cap; in practice counter < 200 for any realistic input. */
const MAX_ITERATIONS = 1_000

/**
 * Compute `Y = hash_to_curve(secret_bytes)` and return its compressed
 * 33-byte serialisation as a lowercase hex string (66 chars, leading
 * `02` or `03`).
 *
 * The input is the raw bytes of the proof's `secret` field — for a Cashu
 * P2PK well-known secret, that's the UTF-8 bytes of the JSON-encoded
 * `["P2PK", {...}]` string.
 */
export const hashToCurveHex = (secretBytes: Uint8Array): string => {
	const msgHash = sha256(concatBytes(DOMAIN_SEPARATOR, secretBytes))

	for (let counter = 0; counter < MAX_ITERATIONS; counter++) {
		const counterBytes = new Uint8Array(4)
		// 4-byte little-endian counter encoding per NUT-00.
		counterBytes[0] = counter & 0xff
		counterBytes[1] = (counter >>> 8) & 0xff
		counterBytes[2] = (counter >>> 16) & 0xff
		counterBytes[3] = (counter >>> 24) & 0xff

		const xHash = sha256(concatBytes(msgHash, counterBytes))

		// Compressed point: 0x02 prefix + 32-byte x. Parsing fails when
		// `x` doesn't correspond to a valid curve point; ~50% chance per
		// attempt.
		const candidate = new Uint8Array(33)
		candidate[0] = 0x02
		candidate.set(xHash, 1)

		try {
			const point = ProjectivePoint.fromHex(candidate)
			return bytesToHex(point.toRawBytes(true))
		} catch {
			// Not on the curve — try the next counter.
			continue
		}
	}

	throw new Error(`hashToCurve: exhausted ${MAX_ITERATIONS} iterations — input is pathological or secp256k1 is broken`)
}

/**
 * Convenience wrapper: take the secret as a UTF-8 string (the most
 * common shape — a Cashu P2PK secret is a JSON string).
 */
export const hashToCurveHexFromString = (secret: string): string => {
	return hashToCurveHex(new TextEncoder().encode(secret))
}

// ---------- tiny utilities --------------------------------------------------

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	let total = 0
	for (const p of parts) total += p.length
	const out = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		out.set(p, offset)
		offset += p.length
	}
	return out
}

const bytesToHex = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i].toString(16).padStart(2, '0')
	}
	return out
}
