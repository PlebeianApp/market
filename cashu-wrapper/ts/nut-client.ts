/**
 * cashu-wrapper/ts/nut-client.ts — a small, self-contained Cashu client for the flows this module's
 * consumers actually drive: NUT-04 minting, NUT-03 swapping, and NUT-11 P2PK-locked spending with a
 * witness.
 *
 * It is deliberately narrow. It is not a wallet: it holds no seed, no store, no balance and no
 * authority. It turns a mint URL plus a handful of blinded messages into proofs, and it turns a
 * locking key into the witness a locked proof needs — nothing else. The caller owns custody,
 * persistence and policy.
 *
 * The three cryptographic primitives are the ones the protocol defines, not invented here:
 *
 *   - the secret is 32 random bytes, hex encoded;
 *   - a point is derived from a secret by hashing the domain separator and the secret to an inner
 *     digest, then hashing `inner || LE32(counter)` and taking the first digest that parses as a
 *     compressed point with an even prefix (the counter is incremented until one does);
 *   - a blinded message is `B_ = Y + r * G`, and a mint signature is unblinded with `C = C_ - r * K`,
 *     where `K` is the mint's public key for that amount. The generator form `C_ - r * G` is the
 *     special case `K = G` and is wrong for any real mint, whose amount key is a random point.
 *
 * The P2PK secret is the NUT-10 two-element array `["P2PK", { nonce, data, tags }]`, JSON-encoded,
 * with every tag value a string; the witness is a JSON string carrying BIP340 signatures over the
 * UTF-8 bytes of that secret, attached to the input that spends it. That two-element array is what
 * cdk and the reference wallets actually parse: the ASCII-prefix form `P2PK[{...}]` travels over the
 * wire unchanged but is not recognised as a lock, so a proof carrying it spends without a witness.
 *
 * No host global is read: the clock, the transport and the randomness are all parameters or imports.
 */
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** The NUT-00 domain separator, exactly the bytes cdk uses. */
export const CASHU_DOMAIN_SEPARATOR = utf8ToBytes('Secp256k1_HashToCurve_Cashu_')

/** A point on secp256k1, as the curve library represents it. */
type SecpPoint = ReturnType<typeof secp256k1.Point.fromHex>

/** A DLEQ proof: `e` and `s` from the mint, plus the blinding factor `r` a proof carries. */
export interface CashuDleq {
	e: string
	s: string
	/** The blinding factor, attached to a proof's DLEQ so the mint can verify it unblinded. */
	r?: string
}

/** NUT-00 proof: an amount, its keyset, its secret and the mint's unblinded signature over it. */
export interface CashuProof {
	amount: number
	id: string
	secret: string
	C: string
	/** The spending witness (NUT-11); a JSON string, carried on the input that spends it. */
	witness?: string
	dleq?: CashuDleq
}

/** NUT-00 blinded message, as a mint request carries it. */
export interface BlindedMessage {
	amount: number
	id: string
	B_: string
}

/** NUT-00 blinded signature, as a mint returns it. */
export interface BlindedSignature {
	amount: number
	id: string
	C_: string
	dleq?: CashuDleq
}

/** The blinding material a caller keeps to unblind one signature. */
export interface BlindingData {
	secret: string
	r: bigint
	B_: string
}

/** One keyset as the mint advertises it. */
export interface CashuKeysetInfo {
	id: string
	unit: string
	active: boolean
	input_fee_ppk?: number
}

/** One keyset's amount-to-public-key map. */
export interface CashuKeyset {
	id: string
	unit: string
	keys: Record<string, string>
}

/** The shape of a NUT-04 mint quote, in every state it passes through. */
export interface MintQuoteResponse {
	quote: string
	request: string
	state: 'UNPAID' | 'PAID' | 'ISSUED' | string
	expiry?: number
	[key: string]: unknown
}

/** A tag on a P2PK lock: a two-element array of strings, exactly as NUT-10 serializes it. */
export type P2PKTag = [string, string]

/** The one object a P2PK secret serializes. */
export interface P2PKLockData {
	nonce: string
	data: string
	tags: P2PKTag[]
}

/** Options for building a P2PK lock. */
export interface P2PKLockOptions {
	/** The nonce; a fresh 32-byte hex value when omitted. */
	nonce?: string
	/** The signature flag tag; `SIG_INPUTS` by default, which is the one a swap witness satisfies. */
	sigflag?: 'SIG_INPUTS' | 'SIG_ALL'
	/** An absolute Unix-seconds locktime; when given it is appended as a `locktime` tag. */
	locktime?: number
	/** An optional refund public key, appended as a `pubkeys` tag. */
	refundPubkey?: string
}

/** The JSON body a NUT-11 witness carries. */
export interface P2PKWitness {
	signatures: string[]
}

/** The error a mint's non-2xx answer raises, carrying the mint's own body verbatim. */
export class CashuMintError extends Error {
	readonly endpoint: string
	readonly status: number
	readonly body: string

	constructor(endpoint: string, status: number, body: string) {
		super(`mint refused ${endpoint} with HTTP ${status}: ${body}`)
		this.name = 'CashuMintError'
		this.endpoint = endpoint
		this.status = status
		this.body = body
	}
}

/** The mint's own metadata, passed through as the mint wrote it. */
export interface CashuMintInfo {
	name?: string
	version?: string
	pubkey?: string
	description?: string
	contact?: unknown
	nuts?: Record<string, unknown>
	motd?: string
	[key: string]: unknown
}

/** Options for the polling mint-quote read. */
export interface AwaitMintQuoteOptions {
	/** Milliseconds between polls; 1000 by default. */
	intervalMs?: number
	/** Give up after this many milliseconds; 60000 by default. */
	timeoutMs?: number
	/** A clock, injected so the poll can be tested without one. Unix milliseconds. */
	now?: () => number
	/** A sleep, injected for the same reason. */
	sleep?: (ms: number) => Promise<void>
}

/** Options for one mint client. */
export interface CashuMintClientOptions {
	/** The mint's base URL, e.g. `https://testnut.cashu.space`. */
	mintUrl: string
	/** The transport; `fetch` by default. */
	fetchImpl?: typeof fetch
}

/** 32 random bytes, hex encoded: the NUT-00 secret. */
export function randomSecretHex(): string {
	return bytesToHex(randomBytes(32))
}

/** A uniformly random scalar in `[1, n - 1]`: the NUT-00 blinding factor. */
export function randomScalar(): bigint {
	return bytesToNumberBE(secp256k1.utils.randomSecretKey())
}

/** Big-endian bytes to a non-negative bigint. */
export function bytesToNumberBE(bytes: Uint8Array): bigint {
	let value = 0n
	for (const byte of bytes) value = (value << 8n) | BigInt(byte)
	return value
}

/** A non-negative bigint to exactly `length` big-endian bytes. */
export function numberToBytesBE(value: bigint, length: number): Uint8Array {
	const out = new Uint8Array(length)
	for (let i = length - 1; i >= 0; i -= 1) {
		out[i] = Number(value & 0xffn)
		value >>= 8n
	}
	return out
}

/** A non-negative bigint to exactly `length` little-endian bytes. */
export function numberToBytesLE(value: bigint, length: number): Uint8Array {
	const out = new Uint8Array(length)
	for (let i = 0; i < length; i += 1) {
		out[i] = Number(value & 0xffn)
		value >>= 8n
	}
	return out
}

/**
 * The NUT-00 hash-to-curve, as the reference wallets and cdk implement it: an inner
 * `sha256(domainSeparator || utf8(secret))`, then `sha256(inner || LE32(counter))` parsed as a
 * compressed point with an even prefix, for the first counter that yields a valid point. The
 * counter is little-endian, which matters for every counter but the first.
 */
export function hashToCurve(secret: string): SecpPoint {
	const inner = sha256(concatBytes(CASHU_DOMAIN_SEPARATOR, utf8ToBytes(secret)))
	for (let counter = 0; counter < 2 ** 16; counter += 1) {
		const digest = sha256(concatBytes(inner, numberToBytesLE(BigInt(counter), 4)))
		const candidate = new Uint8Array(33)
		candidate[0] = 0x02
		candidate.set(digest, 1)
		try {
			const point = secp256k1.Point.fromHex(bytesToHex(candidate))
			point.assertValidity()
			return point
		} catch {
			continue
		}
	}
	throw new Error('hashToCurve: no valid point found in the whole counter range')
}

/** `Y` from a secret. */
export function secretToPoint(secret: string): SecpPoint {
	return hashToCurve(secret)
}

/** `B_ = Y + r * G`, hex encoded, with the blinding factor that opens it. */
export function blindMessage(secret: string, r: bigint = randomScalar()): BlindingData {
	const Y = hashToCurve(secret)
	const B_ = Y.add(secp256k1.Point.BASE.multiply(r))
	return { secret, r, B_: bytesToHex(B_.toBytes(true)) }
}

/** `C = C_ - r * K`, hex encoded: the unblinded signature over the secret's point. */
export function unblindSignature(C_: string, r: bigint, mintPublicKey: string | SecpPoint): string {
	const blinded = secp256k1.Point.fromHex(C_)
	const key = typeof mintPublicKey === 'string' ? secp256k1.Point.fromHex(mintPublicKey) : mintPublicKey
	const C = blinded.subtract(key.multiply(r))
	return bytesToHex(C.toBytes(true))
}

/** The mint's public key for one amount, read from its own keyset. */
export function keysetPublicKey(keyset: Pick<CashuKeyset, 'keys'>, amount: number): string {
	const key = keyset.keys[String(amount)]
	if (!key) throw new Error(`keyset has no key for amount ${amount}`)
	return key
}

/** Unblind one mint signature into the proof it pays for. */
export function unblindBlindedSignature(
	signature: BlindedSignature,
	blinding: BlindingData,
	mintPublicKey: string | SecpPoint,
): CashuProof {
	return {
		amount: signature.amount,
		id: signature.id,
		secret: blinding.secret,
		C: unblindSignature(signature.C_, blinding.r, mintPublicKey),
		...(signature.dleq
			? {
					dleq: {
						e: signature.dleq.e,
						s: signature.dleq.s,
						r: bytesToHex(numberToBytesBE(blinding.r, 32)),
					},
				}
			: {}),
	}
}

/** The point a mint would sign for a proof: `Y` derived from its secret. */
export function proofPoint(proof: Pick<CashuProof, 'secret'>): SecpPoint {
	return hashToCurve(proof.secret)
}

/**
 * The NUT-10/NUT-11 P2PK secret: `JSON.stringify(["P2PK", { nonce, data, tags }])`. The key order is
 * `nonce, data, tags` and every tag value is a string, so the bytes match the reference wallets'.
 */
export function buildP2PKSecret(data: string, options: P2PKLockOptions = {}): string {
	if (!/^0[23][0-9a-f]{64}$/.test(data)) {
		throw new Error(
			'buildP2PKSecret: the lock data must be a 33-byte compressed public key (66 hex). An x-only key is not a valid NUT-11 `data`: the mint cannot parse the secret, so it cannot enforce the lock.',
		)
	}
	const tags: P2PKTag[] = [['sigflag', options.sigflag ?? 'SIG_INPUTS']]
	if (options.refundPubkey) tags.push(['pubkeys', options.refundPubkey])
	if (options.locktime !== undefined) tags.push(['locktime', String(options.locktime)])
	const lock: P2PKLockData = {
		nonce: options.nonce ?? randomSecretHex(),
		data,
		tags,
	}
	return JSON.stringify(['P2PK', lock])
}

/** Parse a P2PK secret back into its object; `null` when the string is not a NUT-10 P2PK array. */
export function parseP2PKSecret(secret: string): P2PKLockData | null {
	try {
		const parsed: unknown = JSON.parse(secret)
		if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== 'P2PK') return null
		const payload = parsed[1] as Partial<P2PKLockData> | null
		if (!payload || typeof payload !== 'object') return null
		if (typeof payload.nonce !== 'string' || typeof payload.data !== 'string' || !Array.isArray(payload.tags)) {
			return null
		}
		return { nonce: payload.nonce, data: payload.data, tags: payload.tags as P2PKTag[] }
	} catch {
		return null
	}
}

/**
 * The locking key's public key, in the 33-byte **compressed** form (66 hex) — which is what NUT-11's
 * `data` field carries and what cdk's own `PublicKey` parses. An x-only key is *not* a valid `data`: the
 * mint cannot parse the secret, and a secret it cannot parse is a secret it cannot enforce.
 */
export function compressedPublicKeyHex(privateKeyHex: string): string {
	return bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKeyHex), true))
}

/** The same key's x-only form (32 bytes), which is what BIP340 verification takes. */
export function xOnlyPublicKeyHex(privateKeyHex: string): string {
	return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex)))
}

/** A fresh BIP340 keypair: the 32-byte secret, its compressed public key and its x-only public key. */
export function generateSchnorrKeypair(): { privateKeyHex: string; publicKeyHex: string; xOnlyPublicKeyHex: string } {
	const { secretKey } = schnorr.keygen()
	const privateKeyHex = bytesToHex(secretKey)
	return {
		privateKeyHex,
		publicKeyHex: compressedPublicKeyHex(privateKeyHex),
		xOnlyPublicKeyHex: xOnlyPublicKeyHex(privateKeyHex),
	}
}

/**
 * The 64-byte BIP340 signature, hex, over **`sha256(secret)`** — not over the secret's bytes. BIP340
 * signs a 32-byte message digest, and cdk signs exactly `sha256(secret.as_bytes())`; signing the raw
 * secret instead produces a signature the mint rejects as invalid.
 */
export function signLockedSecret(secret: string, privateKeyHex: string): string {
	const digest = sha256(utf8ToBytes(secret))
	return bytesToHex(schnorr.sign(digest, hexToBytes(privateKeyHex)))
}

/**
 * Does a hex signature verify against the locking public key over the secret? The key may be given in
 * either form: x-only verification needs only the x coordinate, so a compressed key's prefix is dropped.
 */
export function verifyLockedSecret(secret: string, signatureHex: string, publicKeyHex: string): boolean {
	try {
		const xOnly = publicKeyHex.length === 66 ? publicKeyHex.slice(2) : publicKeyHex
		const digest = sha256(utf8ToBytes(secret))
		return schnorr.verify(hexToBytes(signatureHex), digest, hexToBytes(xOnly))
	} catch {
		return false
	}
}

/** The witness string a NUT-11 swap carries: JSON, in a string, holding the signatures. */
export function buildP2PKWitness(secret: string, privateKeyHex: string): string {
	const witness: P2PKWitness = { signatures: [signLockedSecret(secret, privateKeyHex)] }
	return JSON.stringify(witness)
}

/**
 * A minimal NUT-03/NUT-04 mint client. Every method is a thin, typed wrapper over one endpoint; the
 * transport is injected so the same client runs against a live mint or a test double.
 */
export class CashuMintClient {
	readonly mintUrl: string
	private readonly fetchImpl: typeof fetch

	constructor(options: CashuMintClientOptions) {
		this.mintUrl = options.mintUrl.replace(/\/+$/, '')
		// A free call, never a stored bare reference: `this.fetchImpl(...)` would invoke the platform `fetch`
		// with this client as its receiver, which a browser refuses ("Illegal invocation") even though bun
		// tolerates it. The wrapper keeps the global receiver wherever it runs.
		// (cast: bun's `typeof fetch` carries its own `preconnect`, which a browser transport has no use for)
		this.fetchImpl = options.fetchImpl ?? (((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch)
	}

	private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
		const init: RequestInit = { method, headers: { 'content-type': 'application/json' } }
		if (body !== undefined) init.body = JSON.stringify(body)
		const response = await this.fetchImpl(`${this.mintUrl}${path}`, init)
		const text = await response.text()
		if (!response.ok) throw new CashuMintError(path, response.status, text)
		return JSON.parse(text) as T
	}

	/** `GET /v1/info` — the mint's own metadata. */
	info(): Promise<CashuMintInfo> {
		return this.request<CashuMintInfo>('GET', '/v1/info')
	}

	/** `GET /v1/keysets` — every keyset the mint advertises. */
	keysets(): Promise<{ keysets: CashuKeysetInfo[] }> {
		return this.request<{ keysets: CashuKeysetInfo[] }>('GET', '/v1/keysets')
	}

	/** `GET /v1/keys/{id}` — one keyset's amount-to-public-key map. */
	keys(id: string): Promise<{ keysets: CashuKeyset[] }> {
		return this.request<{ keysets: CashuKeyset[] }>('GET', `/v1/keys/${id}`)
	}

	/** The active keyset for a unit, or `null` when the mint advertises none. */
	async activeKeyset(unit = 'sat'): Promise<CashuKeysetInfo | null> {
		const { keysets } = await this.keysets()
		return keysets.find((keyset) => keyset.unit === unit && keyset.active) ?? null
	}

	/** `POST /v1/mint/quote/bolt11` — request a mint quote. */
	createMintQuote(amount: number, unit = 'sat'): Promise<MintQuoteResponse> {
		return this.request<MintQuoteResponse>('POST', '/v1/mint/quote/bolt11', { amount, unit })
	}

	/** `GET /v1/mint/quote/bolt11/{quote}` — read a mint quote's state. */
	getMintQuote(quote: string): Promise<MintQuoteResponse> {
		return this.request<MintQuoteResponse>('GET', `/v1/mint/quote/bolt11/${encodeURIComponent(quote)}`)
	}

	/**
	 * Poll a mint quote until it is paid. A mint that pays instantly answers on the first read; a real
	 * one may not, so the loop waits rather than assuming.
	 */
	async awaitMintQuotePaid(quote: string, options: AwaitMintQuoteOptions = {}): Promise<MintQuoteResponse> {
		const intervalMs = options.intervalMs ?? 1000
		const timeoutMs = options.timeoutMs ?? 60000
		const now = options.now ?? (() => Date.now())
		const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
		const deadline = now() + timeoutMs
		for (;;) {
			const state = await this.getMintQuote(quote)
			if (state.state === 'PAID' || state.state === 'ISSUED') return state
			if (now() >= deadline) throw new Error(`mint quote ${quote} still ${state.state} after ${timeoutMs}ms`)
			await sleep(intervalMs)
		}
	}

	/** `POST /v1/mint/bolt11` — redeem a paid quote for signatures. */
	mint(quote: string, outputs: BlindedMessage[]): Promise<{ signatures: BlindedSignature[] }> {
		return this.request<{ signatures: BlindedSignature[] }>('POST', '/v1/mint/bolt11', { quote, outputs })
	}

	/**
	 * `POST /v1/swap` — spend inputs for fresh signatures. A NUT-11 witness belongs on the input it
	 * spends (`CashuProof.witness`, a JSON string); cdk ignores a request-level `witness`, so the
	 * parameter here is only for mints that read one.
	 */
	swap(
		inputs: CashuProof[],
		outputs: BlindedMessage[],
		witness?: string,
	): Promise<{ signatures: BlindedSignature[] }> {
		const body: Record<string, unknown> = { inputs, outputs }
		if (witness !== undefined) body.witness = witness
		return this.request<{ signatures: BlindedSignature[] }>('POST', '/v1/swap', body)
	}
}

/**
 * The keyset's input fee for `inputCount` inputs, in whole sat: `ceil(input_fee_ppk * inputs / 1000)`.
 * A swap must balance exactly — `sum(inputs) == sum(outputs) + fee` — so a caller adds this to its
 * outputs rather than approximating.
 */
export function inputFee(inputFeePpk: number, inputCount: number): number {
	if (inputCount <= 0) return 0
	return Math.ceil((inputFeePpk * inputCount) / 1000)
}

/** Mint `amount` sat as the power-of-two split a keyset can sign, as blinded outputs. */
export function splitAmount(amount: number): number[] {
	const parts: number[] = []
	let remaining = amount
	let bit = 1
	while (remaining > 0 && bit <= amount) {
		if (remaining & bit) parts.push(bit)
		remaining &= ~bit
		bit <<= 1
	}
	return parts
}

/** Build one blinded output per part, each with its own secret and blinding factor. */
export function buildBlindedOutputs(parts: number[], id: string): { outputs: BlindedMessage[]; blindings: BlindingData[] } {
	const blindings: BlindingData[] = []
	const outputs: BlindedMessage[] = []
	for (const amount of parts) {
		const blinding = blindMessage(randomSecretHex())
		blindings.push(blinding)
		outputs.push({ amount, id, B_: blinding.B_ })
	}
	return { outputs, blindings }
}
