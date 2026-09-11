/**
 * In-process NUT-12 DLEQ fixture — test-only, fully offline.
 *
 * DLEQ (Discreet Log Equality, Cashu NUT-12) proofs let a third party verify,
 * *without* contacting the mint, that a proof was really minted for a given
 * amount and keyset. The production verification path wraps
 * `hasValidDleq(proof, keyset)` from `@cashu/cashu-ts` (see `dleq.ts`), which
 * re-derives the blinded message `B' = Y + r·G` and the blinded signature
 * `C' = C + r·A` from the blinding factor `r`, then runs the DLEQ
 * Schnorr-style check.
 *
 * Constructing a proof that *actually passes* requires the mint side: a
 * keyset private key `a` (whose public key `A = a·G` is `keys[amount]`), the
 * blinding factor `r`, and the challenge/response `e`/`s` computed over the
 * blinded values. cashu-ts exposes the mint-side constructor
 * (`createDLEQProof`) and the curve helpers (`hashToCurve`, `pointFromHex`)
 * under its `crypto/*` subpaths — the *same* library `hasValidDleq` uses — so
 * this fixture is byte-compatible with the verifier by construction.
 *
 * Everything here is **mostly deterministic** (fixed mint key scalars,
 * fixed blinding factor => C, r, id, amount, secret are stable across
 * calls). The DLEQ challenge/response e/s carry a fresh random nonce
 * each call (exactly as a real mint produces), which is documented and
 * tested accordingly.
 */

import { createDLEQProof } from '@cashu/cashu-ts/crypto/mint/NUT12'
import { getPubKeyFromPrivKey } from '@cashu/cashu-ts/crypto/mint'
import { hashToCurve, pointFromHex } from '@cashu/cashu-ts/crypto/common'
import { bytesToNumber } from '@cashu/cashu-ts/crypto/util'
import type { MintKeys } from '@cashu/cashu-ts'

// ---------- Public types ----------------------------------------------------

/**
 * A serialized NUT-12 DLEQ proof. Mirrors `DleqProof` in `dleq.ts`; kept
 * standalone here so the fixture has no dependency on the (separately
 * delivered) verification module.
 */
export interface DleqProof {
	/** Keyset ID (hex). */
	id: string
	/** Amount denominated in Satoshis. */
	amount: number
	/** Unblinded signature `C` (compressed secp256k1 hex, 66 chars). */
	C: string
	/** DLEQ challenge `e` (32 bytes, hex). */
	e: string
	/** DLEQ response `s` (32 bytes, hex). */
	s: string
	/** Blinding factor `r` (32 bytes big-endian, hex). */
	r: string
}

/** A DLEQ proof plus the wallet secret it was minted against. */
export interface DleqProofWithSecret extends DleqProof {
	secret: string
}

/** A self-consistent keyset + honest proof pair. */
export interface HonestDleqFixture {
	/** The keyset the proof verifies against. */
	keyset: MintKeys
	/** The wallet secret used to mint the proof. */
	secret: string
	/** A proof for which `hasValidDleq(proof, keyset) === true`. */
	proof: DleqProofWithSecret
}

/** Fields that can be corrupted for negative tests. */
export type CorruptibleField = 'C' | 'e' | 's' | 'r' | 'amount' | 'secret' | 'id'

// ---------- Deterministic scalar constants ----------------------------------

/**
 * Base mint private key (small positive integer). Per-amount keys are derived
 * as `BASE + amount` so each denomination has a *distinct* key — which makes
 * an amount-corruption that targets a different denomination also flip the
 * verifying key and fail.
 */
const BASE_MINT_PRIV = 42
/** Fixed blinding factor for every honest proof (small positive integer). */
const BLINDING_FACTOR = 1337
/** Default wallet secret (UTF-8). */
export const DEFAULT_FIXTURE_SECRET = 'dleq-fixture-secret'
/** Standard Cashu denominations covered by the default keyset. */
export const DEFAULT_FIXTURE_AMOUNTS: number[] = [1, 2, 4, 8, 16, 32, 64, 128]
/** Keyset id for the default keyset (16 hex chars, realistic NUT length). */
export const FIXTURE_KEYSET_ID = '00deadbeef000001'

/**
 * Options for deriving an alternate (e.g. rotated) fixture keyset/proof pair.
 *
 * Distinct `basePrivKey` values yield cryptographically distinct keysets, so a
 * proof honest under one base does NOT verify under another. This is what
 * multi-keyset tests (a bid whose proofs span two keysets) need.
 */
export interface DleqFixtureKeysetOptions {
	/** Keyset id the keyset/proof advertises. Defaults to {@link FIXTURE_KEYSET_ID}. */
	keysetId?: string
	/** Base mint private-key scalar. Defaults to the fixed {@link BASE_MINT_PRIV}. */
	basePrivKey?: number
}

// ---------- Tiny byte/hex helpers -------------------------------------------

const bytesToHex = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
	return out
}

/**
 * Encode a small non-negative integer (fits in 32 bits) as 32 big-endian
 * bytes, which is a valid secp256k1 private-key scalar.
 */
const numberToBytes32 = (n: number): Uint8Array => {
	const out = new Uint8Array(32)
	out[31] = n & 0xff
	out[30] = (n >>> 8) & 0xff
	out[29] = (n >>> 16) & 0xff
	out[28] = (n >>> 24) & 0xff
	return out
}

/** Serialize a point to its 33-byte compressed hex form (66 chars). */
const compressedHex = (p: { toHex: (isCompressed?: boolean) => string }): string => p.toHex(true)

// ---------- Mint-side helpers -----------------------------------------------

/** 32-byte mint private key for a given amount (distinct per amount/base). */
const mintPrivateKeyBytes = (amount: number, basePrivKey: number = BASE_MINT_PRIV): Uint8Array => numberToBytes32(basePrivKey + amount)

/** Compressed public key `A = a·G` for a given amount (the keyset entry). */
const mintPublicKeyHex = (amount: number, basePrivKey: number = BASE_MINT_PRIV): string =>
	bytesToHex(getPubKeyFromPrivKey(mintPrivateKeyBytes(amount, basePrivKey)))

// ---------- Public factories ------------------------------------------------

/**
 * Construct a deterministic keyset `{ id, unit: 'sat', keys: { [amt]: pubkey } }`.
 *
 * Each amount gets a **distinct** public key (derived from a per-amount mint
 * private key), so an amount-corruption that targets a different — but still
 * present — denomination also flips the verifying key and fails.
 */
export const makeDleqKeyset = (amounts: number[] = DEFAULT_FIXTURE_AMOUNTS, opts: DleqFixtureKeysetOptions = {}): MintKeys => {
	const basePrivKey = opts.basePrivKey ?? BASE_MINT_PRIV
	const keys: Record<number, string> = {}
	for (const amount of amounts) keys[amount] = mintPublicKeyHex(amount, basePrivKey)
	return { id: opts.keysetId ?? FIXTURE_KEYSET_ID, unit: 'sat', keys }
}

/**
 * Construct an honest, deterministic DLEQ proof for a given amount and
 * secret, valid against the keyset produced by {@link makeDleqKeyset}.
 *
 * This reproduces the mint side of a NUT-12 mint: hash the secret to a curve
 * point `Y`, blind it with `r`, sign with the per-amount mint key `a`, and
 * emit the DLEQ challenge/response over the blinded values.
 */
export const makeHonestDleqProof = (
	amount = 1,
	secret: string = DEFAULT_FIXTURE_SECRET,
	opts: DleqFixtureKeysetOptions = {},
): DleqProofWithSecret => {
	const aBytes = mintPrivateKeyBytes(amount, opts.basePrivKey ?? BASE_MINT_PRIV)
	const secretBytes = new TextEncoder().encode(secret)
	const Y = hashToCurve(secretBytes)

	// Blinded message B' = Y + r·G.
	const rBytes = numberToBytes32(BLINDING_FACTOR)
	const rG = pointFromHex(bytesToHex(getPubKeyFromPrivKey(rBytes)))
	const B_ = Y.add(rG)

	// Unblinded signature C = a·Y (what the wallet holds after unblinding).
	const C = Y.multiply(bytesToNumber(aBytes))

	// Mint-side DLEQ proof over (B', C') with key a.
	const { e, s } = createDLEQProof(B_, aBytes)

	return {
		id: opts.keysetId ?? FIXTURE_KEYSET_ID,
		amount,
		C: compressedHex(C),
		e: bytesToHex(e),
		s: bytesToHex(s),
		r: bytesToHex(rBytes),
		secret,
	}
}

/**
 * Convenience: a self-consistent keyset + honest proof for one amount.
 * The primary entry point for happy-path DLEQ tests.
 */
export const makeHonestDleqFixture = (amount = 1, secret: string = DEFAULT_FIXTURE_SECRET): HonestDleqFixture => {
	const keyset = makeDleqKeyset()
	const proof = makeHonestDleqProof(amount, secret)
	return { keyset, secret, proof }
}

// ---------- Corruption helpers ----------------------------------------------

/** Compressed generator point — a valid point, but not `a·Y` for our proof. */
const GENERATOR_COMPRESSED_HEX = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

/**
 * Return a copy of `proof` with a single field corrupted.
 *
 * Each corruption is crypto-detectable (the proof no longer verifies against
 * the matching keyset) with one deliberate exception: `id`. `hasValidDleq`
 * does not check the keyset id — it only looks up `keys[amount]` — so an `id`
 * corruption is meaningful for *structural/schema* validation (valid keyset
 * id hex) but is invisible to the crypto check. Documented here so consumers
 * don't mistake it for a crypto negative case.
 */
export const corruptField = (proof: DleqProofWithSecret, field: CorruptibleField): DleqProofWithSecret => {
	switch (field) {
		case 'C':
			// Replace the signature point with the generator — a valid curve
			// point, but not the unblinded signature for this secret/amount.
			return { ...proof, C: GENERATOR_COMPRESSED_HEX }
		case 'e':
			// Zero the challenge.
			return { ...proof, e: '00'.repeat(32) }
		case 's':
			// Zero the response.
			return { ...proof, s: '00'.repeat(32) }
		case 'r':
			// A different (but well-formed) blinding factor.
			return { ...proof, r: bytesToHex(numberToBytes32(BLINDING_FACTOR + 1)) }
		case 'amount':
			// Flip to a neighbouring denomination. When `amount+1` is in the
			// keyset, the distinct per-amount key makes verification fail
			// (wrong pubkey). When it is NOT in the keyset (e.g. amount=2→3,
			// or amount=128→129), `hasValidDleq` *throws* ("undefined key for
			// amount") — which the production wrapper `verifyProofDleq`
			// catches and returns false for (fail-closed). Callers should
			// normalise via try/catch if calling `hasValidDleq` directly.
			return { ...proof, amount: proof.amount + 1 }
		case 'secret':
			// Corrupt the wallet secret → different Y.
			return { ...proof, secret: proof.secret + '-corrupt' }
		case 'id':
			// Non-matching keyset id (structural/schema-level, not crypto).
			return { ...proof, id: '00fffffff0000001' }
	}
}
