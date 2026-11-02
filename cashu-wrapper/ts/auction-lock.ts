/**
 * auction-lock.ts — the strict NUT-10/NUT-11 auction-lock reader, mirroring the market's own.
 *
 * ## Why this mirrors rather than reinterprets
 *
 * AUCTIONS.md §5.3 gives the exact secret the bidder must lock with, and ADR-0003's validator rules name the
 * invariants: **L2.3** each `lock_secret` parses as valid NUT-10 P2PK; **L2.5** the lock pubkey inside the secret
 * equals `child_pubkey`; **L2.6** the locktime inside the secret equals the bid's `locktime`; **L2.7** the refund
 * key inside the secret equals `refund_pubkey`. The market enforces them in `parseAuctionLockSecret`
 * (`market/src/lib/cashu/p2pkSecret.ts:256-320`) and maps a parse failure onto the verdict reason `bad_lock`.
 *
 * This module is a faithful transcription of that parser's **structure checks and reason codes**, in the same
 * order, so that this tree cannot build or accept a lock the market would condemn. On any failure it refuses
 * **by name**: `readAuctionLock` throws an {@link AuctionLockRefusedError} whose `reason` is one of the market's
 * own codes. Nothing here invents a key or repairs a secret.
 *
 * ## The shape it accepts (AUCTIONS.md §5.3)
 *
 * ```json
 * ["P2PK", { "nonce": "…", "data": "<seller_child_pubkey>", "tags": [
 *   ["sigflag", "SIG_INPUTS"], ["locktime", "<unix seconds>"],
 *   ["refund", "<bidder_refund_pubkey>"], ["n_sigs_refund", "1"] ] }]
 * ```
 *
 * A missing `sigflag` defaults to `SIG_INPUTS` and a missing `n_sigs_refund` to `1`, exactly as the market's
 * parser defaults them (and as cashu-ts emits them: it writes `n_sigs_refund` only above 1 and `sigflag` only for
 * `SIG_ALL`). The `data` is the compressed 33-byte child key; the `refund` tag is the bidder's separate refund
 * key; the `pubkeys` multisig slot must be empty (the lock is 1-of-1, §5.2).
 */

export type SigFlag = 'SIG_INPUTS' | 'SIG_ALL'

/** A structurally valid auction lock, with the three terms the market's rules compare. */
export interface ParsedAuctionLock {
	/** NUT-11 `data`: the single lock pubkey — must equal `child_pubkey` (ADR-0003 L2.5). */
	readonly childPubkey: string
	/** Additional keys from the `pubkeys` tag; must be empty for a 1-of-1 auction lock. */
	readonly additionalPubkeys: readonly string[]
	/** Required signatures pre-locktime; must be 1 (AUCTIONS.md §5.2). */
	readonly nSigs: number
	/** NUT-11 `locktime`: `max_end_at + settlement_grace` (ADR-0003 L2.6). */
	readonly locktime: number
	/** The single refund key — must equal `refund_pubkey` (ADR-0003 L2.7). */
	readonly refundPubkey: string
	/** Required signatures post-locktime; must be 1 (§5.2). */
	readonly nSigsRefund: number
	readonly sigflag: SigFlag
	readonly nonce: string
}

/** Discriminated parse result — the market's own shape, so a failure carries a `reason` a caller can name. */
export type AuctionLockParse = { readonly ok: true; readonly value: ParsedAuctionLock } | { readonly ok: false; readonly reason: string; readonly detail?: string }

/** What the three terms must equal, when the caller knows them (the rail and the bid publisher both do). */
export interface AuctionLockConstraints {
	readonly expectedLocktime: number
	readonly expectedChildPubkey: string
	readonly expectedRefundPubkey: string
	readonly expectedSigflag?: SigFlag
}

import { RefusedError } from './errors'

/**
 * Refused **by name**: a lock that is not the auction's lock. The `reason` is the market's own code
 * (`lock_missing_locktime`, `lock_pubkey_mismatch`, …); the message prefixes `refused-bid-lock:` so a caller can
 * tell this refusal from any other error. Extends {@link RefusedError} so the refusal carries a `code` the host
 * accepts (`host.ts:372-383`): `refused_bid_lock`, not the generic `adapter_failure`.
 */
export class AuctionLockRefusedError extends RefusedError {
	readonly reason: string
	constructor(reason: string, detail?: string) {
		super(`refused-bid-lock: ${reason}${detail === undefined ? '' : ` — ${detail}`}`)
		this.name = 'AuctionLockRefusedError'
		this.reason = reason
	}
}

const COMPRESSED_SECP256K1_HEX = /^0[23][0-9a-fA-F]{64}$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const readTagValue = (tags: string[][], key: string): string | undefined => {
	for (const tag of tags) if (tag[0] === key) return tag[1]
	return undefined
}

const readTagValuesMulti = (tags: string[][], key: string): string[] => {
	const out: string[] = []
	for (const tag of tags) {
		if (tag[0] !== key) continue
		for (let i = 1; i < tag.length; i += 1) {
			const value = tag[i]
			if (typeof value === 'string' && value.length > 0) out.push(value)
		}
	}
	return out
}

const parseIntegerTag = (tags: string[][], key: string): number | undefined => {
	const raw = readTagValue(tags, key)
	if (raw === undefined) return undefined
	const value = Number.parseInt(raw, 10)
	if (!Number.isFinite(value) || String(value) !== raw.replace(/^[+\s]+/, '')) return undefined
	return value
}

/**
 * Parse a Cashu proof's `secret` as an auction bid lock. Structure first (the market's loose parse), then the
 * auction's own invariants (its strict parse). With no `constraints`, the structural rules alone are checked —
 * which is what a reader of a just-placed lock (whose expected terms are the lock's own terms) needs.
 */
export function parseAuctionLockSecret(secret: string, constraints?: AuctionLockConstraints): AuctionLockParse {
	let outer: unknown
	try {
		outer = JSON.parse(secret)
	} catch (error) {
		return { ok: false, reason: 'secret_not_json', detail: error instanceof Error ? error.message : undefined }
	}
	if (!Array.isArray(outer) || outer.length < 2) return { ok: false, reason: 'secret_shape', detail: 'expected ["P2PK", { ... }]' }
	const [kind, inner] = outer
	if (kind !== 'P2PK') return { ok: false, reason: 'secret_kind', detail: `expected "P2PK" got ${JSON.stringify(kind)}` }
	if (!isObject(inner)) return { ok: false, reason: 'secret_inner_shape', detail: 'expected an object as the second element' }

	const nonce = typeof inner.nonce === 'string' ? inner.nonce : ''
	if (!nonce) return { ok: false, reason: 'missing_nonce' }
	const data = typeof inner.data === 'string' ? inner.data : ''
	if (!data) return { ok: false, reason: 'missing_data_pubkey' }
	if (!COMPRESSED_SECP256K1_HEX.test(data)) return { ok: false, reason: 'invalid_pubkey_format', detail: `data=${data}` }

	const tagsRaw = inner.tags
	if (tagsRaw !== undefined && !Array.isArray(tagsRaw)) return { ok: false, reason: 'invalid_tags_shape' }
	const tags: string[][] = []
	if (Array.isArray(tagsRaw)) {
		for (const entry of tagsRaw) {
			if (!isStringArray(entry)) return { ok: false, reason: 'invalid_tag_entry', detail: JSON.stringify(entry) }
			tags.push(entry)
		}
	}

	const additionalPubkeys = readTagValuesMulti(tags, 'pubkeys')
	for (const pubkey of additionalPubkeys) {
		if (!COMPRESSED_SECP256K1_HEX.test(pubkey)) return { ok: false, reason: 'invalid_pubkey_format', detail: `pubkeys: ${pubkey}` }
	}
	const refundPubkeys = readTagValuesMulti(tags, 'refund')
	for (const pubkey of refundPubkeys) {
		if (!COMPRESSED_SECP256K1_HEX.test(pubkey)) return { ok: false, reason: 'invalid_pubkey_format', detail: `refund: ${pubkey}` }
	}

	const nSigs = parseIntegerTag(tags, 'n_sigs') ?? 1
	const nSigsRefund = parseIntegerTag(tags, 'n_sigs_refund') ?? 1
	const locktime = parseIntegerTag(tags, 'locktime')
	const sigflagRaw = readTagValue(tags, 'sigflag') ?? 'SIG_INPUTS'
	if (sigflagRaw !== 'SIG_INPUTS' && sigflagRaw !== 'SIG_ALL') return { ok: false, reason: 'invalid_sigflag', detail: sigflagRaw }

	const expectedSigflag = constraints?.expectedSigflag ?? 'SIG_INPUTS'
	if (additionalPubkeys.length > 0) {
		return { ok: false, reason: 'lock_multi_key', detail: `expected 1 lock pubkey, found ${1 + additionalPubkeys.length}` }
	}
	if (nSigs !== 1) return { ok: false, reason: 'lock_n_sigs_invalid', detail: `n_sigs=${nSigs}` }
	if (sigflagRaw !== expectedSigflag) return { ok: false, reason: 'lock_sigflag_invalid', detail: `sigflag=${sigflagRaw}` }
	if (locktime === undefined) return { ok: false, reason: 'lock_missing_locktime' }
	if (constraints !== undefined && locktime !== constraints.expectedLocktime) {
		return { ok: false, reason: 'lock_locktime_mismatch', detail: `expected ${constraints.expectedLocktime}, got ${locktime}` }
	}
	if (refundPubkeys.length !== 1) {
		return { ok: false, reason: 'lock_refund_count_invalid', detail: `expected 1 refund key, got ${refundPubkeys.length}` }
	}
	if (nSigsRefund !== 1) return { ok: false, reason: 'lock_n_sigs_refund_invalid', detail: `n_sigs_refund=${nSigsRefund}` }
	if (constraints !== undefined && data.toLowerCase() !== constraints.expectedChildPubkey.toLowerCase()) {
		return { ok: false, reason: 'lock_pubkey_mismatch', detail: `expected ${constraints.expectedChildPubkey}, got ${data}` }
	}
	if (constraints !== undefined && refundPubkeys[0]!.toLowerCase() !== constraints.expectedRefundPubkey.toLowerCase()) {
		return { ok: false, reason: 'lock_refund_mismatch', detail: `expected ${constraints.expectedRefundPubkey}, got ${refundPubkeys[0]}` }
	}

	return {
		ok: true,
		value: {
			childPubkey: data,
			additionalPubkeys,
			nSigs,
			locktime,
			refundPubkey: refundPubkeys[0]!,
			nSigsRefund,
			sigflag: sigflagRaw,
			nonce,
		},
	}
}

/** The same parse, but a failure is **thrown by name** rather than returned, for callers that must not continue. */
export function readAuctionLock(secret: string, constraints?: AuctionLockConstraints): ParsedAuctionLock {
	const parsed = parseAuctionLockSecret(secret, constraints)
	if (!parsed.ok) throw new AuctionLockRefusedError(parsed.reason, parsed.detail)
	return parsed.value
}

/**
 * Build the exact §5.3 secret for a lock: `data` = the seller child pubkey, one `locktime`, one `refund` key,
 * `n_sigs_refund=1`, `sigflag=SIG_INPUTS`. This is the shape the market's parser accepts and the shape
 * `readAuctionLock` expects; `buildAuctionLockSecret` is used by tests, while production locks are minted by
 * Coco/cashu-ts with the same tags.
 */
export function buildAuctionLockSecret(input: {
	readonly childPubkey: string
	readonly locktime: number
	readonly refundPubkey: string
	readonly nonce?: string
	readonly sigflag?: SigFlag
}): string {
	if (!COMPRESSED_SECP256K1_HEX.test(input.childPubkey)) {
		throw new AuctionLockRefusedError('invalid_pubkey_format', `child_pubkey=${input.childPubkey}`)
	}
	if (!COMPRESSED_SECP256K1_HEX.test(input.refundPubkey)) {
		throw new AuctionLockRefusedError('invalid_pubkey_format', `refund_pubkey=${input.refundPubkey}`)
	}
	if (!Number.isSafeInteger(input.locktime) || input.locktime <= 0) {
		throw new AuctionLockRefusedError('lock_missing_locktime', `locktime=${input.locktime}`)
	}
	const nonce = input.nonce ?? randomHex32()
	return JSON.stringify([
		'P2PK',
		{
			nonce,
			data: input.childPubkey,
			tags: [
				['sigflag', input.sigflag ?? 'SIG_INPUTS'],
				['locktime', String(input.locktime)],
				['refund', input.refundPubkey],
				['n_sigs_refund', '1'],
			],
		},
	])
}

function randomHex32(): string {
	const bytes = new Uint8Array(32)
	const holder = globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }
	if (typeof holder.crypto?.getRandomValues === 'function') holder.crypto.getRandomValues(bytes)
	else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
