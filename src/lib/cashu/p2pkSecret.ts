/**
 * NUT-10 / NUT-11 P2PK well-known secret parser.
 *
 * The Cashu proof's `secret` field, when locked, is a JSON-encoded
 * tuple-style "well-known secret":
 *
 *   ["P2PK", { "nonce": "...", "data": "<pubkey>", "tags": [...] }]
 *
 * The inner `tags` is a flat array of `[key, value, ...]` arrays — the
 * same shape as Nostr event tags but with NUT-11-specific keys:
 * `pubkeys`, `n_sigs`, `locktime`, `refund`, `n_sigs_refund`, `sigflag`.
 *
 * This module exposes:
 *
 * - {@link parseP2PKSecret}      — accept any well-formed P2PK secret.
 *   Loose parsing for general callers (wallet, UI display).
 *
 * - {@link parseAuctionLockSecret} — strict parsing for auction bid
 *   locks. Enforces the §5.3 shape: single pubkey, `n_sigs=1`,
 *   `n_sigs_refund=1`, `sigflag=SIG_INPUTS`, mandatory `locktime` and
 *   `refund`. Returns a discriminated `{ ok: true, value }` /
 *   `{ ok: false, reason, detail }` result so validators can map
 *   parse failures directly onto the `bad_lock` reason without
 *   throwing.
 *
 * Reference: NUT-10 https://github.com/cashubtc/nuts/blob/main/10.md,
 *            NUT-11 https://github.com/cashubtc/nuts/blob/main/11.md
 */

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type SigFlag = 'SIG_INPUTS' | 'SIG_ALL'

/** Loose, fully-parsed P2PK secret. Any callable shape. */
export interface ParsedP2PKSecret {
	/** Primary lock pubkey (compressed secp256k1 hex). NUT-11 `data`. */
	pubkey: string
	/** Additional pubkeys from the `pubkeys` tag, in declaration order. */
	additionalPubkeys: string[]
	/**
	 * All authorised spending pubkeys in declaration order:
	 * `[pubkey, ...additionalPubkeys]`. Convenience accessor.
	 */
	allPubkeys: string[]
	/** Required signatures pre-locktime. NUT-11 `n_sigs`. Default 1. */
	nSigs: number
	/** Lock expiry in unix seconds. NUT-11 `locktime`. `undefined` when absent. */
	locktime?: number
	/** Refund pubkeys allowed to spend post-locktime. NUT-11 `refund`. */
	refundPubkeys: string[]
	/** Required signatures post-locktime. NUT-11 `n_sigs_refund`. Default 1. */
	nSigsRefund: number
	/** Signature flag. NUT-11 `sigflag`. Default `SIG_INPUTS`. */
	sigflag: SigFlag
	/** Random nonce binding the secret to one Cashu proof. */
	nonce: string
}

/**
 * The strict-mode shape used by auction bid locks. Adds the
 * `bidder_path_v1` invariants on top of {@link ParsedP2PKSecret}:
 * exactly one lock pubkey, locktime present, exactly one refund key,
 * `n_sigs=1`, `n_sigs_refund=1`.
 */
export interface AuctionLockSecret extends ParsedP2PKSecret {
	pubkey: string
	locktime: number
	refundPubkey: string
}

/** Discriminated parse result. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string; detail?: string }

// ----------------------------------------------------------------------------
// Loose parser
// ----------------------------------------------------------------------------

const COMPRESSED_SECP256K1_HEX = /^0[23][0-9a-fA-F]{64}$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

/**
 * Read a tag's first value by key. Returns `undefined` when the tag is
 * absent or has no second element.
 */
const readTagValue = (tags: string[][], key: string): string | undefined => {
	for (const tag of tags) {
		if (tag[0] === key) return tag[1]
	}
	return undefined
}

/**
 * Read all values of a multi-value tag (e.g. `pubkeys`, `refund`).
 *
 * Per NUT-11, multi-pubkey constructions can put either:
 *   - one pubkey per tag with repeated tag keys, or
 *   - multiple pubkey values inside a single tag (`["pubkeys", pk1, pk2, ...]`).
 *
 * We accept both. We do not deduplicate — order is preserved.
 */
const readTagValuesMulti = (tags: string[][], key: string): string[] => {
	const out: string[] = []
	for (const tag of tags) {
		if (tag[0] !== key) continue
		for (let i = 1; i < tag.length; i++) {
			const v = tag[i]
			if (typeof v === 'string' && v.length > 0) out.push(v)
		}
	}
	return out
}

const parseIntegerTag = (tags: string[][], key: string): number | undefined => {
	const raw = readTagValue(tags, key)
	if (raw === undefined) return undefined
	const n = Number.parseInt(raw, 10)
	if (!Number.isFinite(n) || String(n) !== raw.replace(/^[+\s]+/, '')) return undefined
	return n
}

/**
 * Parse a P2PK well-known secret JSON string into a structured object.
 * No semantic validation beyond "is the JSON shape recognisable" — use
 * this for general callers (UI display, generic Cashu code). Auction
 * validators MUST use {@link parseAuctionLockSecret} instead.
 *
 * Returns a `ParseResult<ParsedP2PKSecret>` rather than throwing so
 * callers can route parse failures into reason codes.
 */
export const parseP2PKSecret = (secret: string): ParseResult<ParsedP2PKSecret> => {
	let outer: unknown
	try {
		outer = JSON.parse(secret)
	} catch (err) {
		return { ok: false, reason: 'secret_not_json', detail: err instanceof Error ? err.message : undefined }
	}

	if (!Array.isArray(outer) || outer.length < 2) {
		return { ok: false, reason: 'secret_shape', detail: 'expected ["P2PK", { ... }]' }
	}

	const [kind, inner] = outer
	if (kind !== 'P2PK') {
		return { ok: false, reason: 'secret_kind', detail: `expected "P2PK" got ${JSON.stringify(kind)}` }
	}
	if (!isObject(inner)) {
		return { ok: false, reason: 'secret_inner_shape', detail: 'expected object as second element' }
	}

	const nonce = typeof inner.nonce === 'string' ? inner.nonce : ''
	if (!nonce) return { ok: false, reason: 'missing_nonce' }

	const data = typeof inner.data === 'string' ? inner.data : ''
	if (!data) return { ok: false, reason: 'missing_data_pubkey' }
	if (!COMPRESSED_SECP256K1_HEX.test(data)) {
		return { ok: false, reason: 'invalid_pubkey_format', detail: `data=${data}` }
	}

	const tagsRaw = inner.tags
	if (tagsRaw !== undefined && !Array.isArray(tagsRaw)) {
		return { ok: false, reason: 'invalid_tags_shape' }
	}
	const tags: string[][] = []
	if (Array.isArray(tagsRaw)) {
		for (const t of tagsRaw) {
			if (!isStringArray(t)) {
				return { ok: false, reason: 'invalid_tag_entry', detail: JSON.stringify(t) }
			}
			tags.push(t)
		}
	}

	const additionalPubkeys = readTagValuesMulti(tags, 'pubkeys')
	for (const pk of additionalPubkeys) {
		if (!COMPRESSED_SECP256K1_HEX.test(pk)) {
			return { ok: false, reason: 'invalid_pubkey_format', detail: `pubkeys: ${pk}` }
		}
	}

	const refundPubkeys = readTagValuesMulti(tags, 'refund')
	for (const pk of refundPubkeys) {
		if (!COMPRESSED_SECP256K1_HEX.test(pk)) {
			return { ok: false, reason: 'invalid_pubkey_format', detail: `refund: ${pk}` }
		}
	}

	const nSigs = parseIntegerTag(tags, 'n_sigs') ?? 1
	const nSigsRefund = parseIntegerTag(tags, 'n_sigs_refund') ?? 1
	const locktime = parseIntegerTag(tags, 'locktime')
	const sigflagRaw = readTagValue(tags, 'sigflag') ?? 'SIG_INPUTS'
	if (sigflagRaw !== 'SIG_INPUTS' && sigflagRaw !== 'SIG_ALL') {
		return { ok: false, reason: 'invalid_sigflag', detail: sigflagRaw }
	}

	return {
		ok: true,
		value: {
			pubkey: data,
			additionalPubkeys,
			allPubkeys: [data, ...additionalPubkeys],
			nSigs,
			locktime,
			refundPubkeys,
			nSigsRefund,
			sigflag: sigflagRaw,
			nonce,
		},
	}
}

// ----------------------------------------------------------------------------
// Strict auction-rule parser (used by validators)
// ----------------------------------------------------------------------------

/**
 * Constraints a bid lock MUST satisfy under `cashu_p2pk_bidder_path_v1`
 * — see AUCTIONS.md §5.3.
 */
export interface AuctionLockConstraints {
	/**
	 * Required exact value for `locktime`. Typically
	 * `auction.max_end_at + auction.settlement_grace`.
	 */
	expectedLocktime: number
	/**
	 * Required value for the single lock pubkey (`data`). The bid event's
	 * `child_pubkey` tag.
	 */
	expectedChildPubkey: string
	/**
	 * Required value for the refund pubkey. The bid event's
	 * `refund_pubkey` tag.
	 */
	expectedRefundPubkey: string
	/** Optional override for the required sigflag. Defaults to `SIG_INPUTS`. */
	expectedSigflag?: SigFlag
}

/**
 * Parse a Cashu proof's secret as an auction bid lock and verify it
 * against the auction's expected shape (§5.3).
 *
 * On success returns a `value` with the `pubkey`, `locktime`, and
 * `refundPubkey` narrowed to required (non-optional) — every auction
 * lock has all three.
 *
 * On failure returns a `reason` validators can use directly to emit a
 * `bid_invalid` verdict with `reason=bad_lock` (plus the `detail`
 * string for human-readable diagnostics in the verdict's `content`).
 */
export const parseAuctionLockSecret = (
	secret: string,
	constraints: AuctionLockConstraints,
): ParseResult<AuctionLockSecret> => {
	const loose = parseP2PKSecret(secret)
	if (!loose.ok) return loose

	const parsed = loose.value
	const expectedSigflag = constraints.expectedSigflag ?? 'SIG_INPUTS'

	if (parsed.additionalPubkeys.length > 0) {
		return {
			ok: false,
			reason: 'lock_multi_key',
			detail: `expected 1 lock pubkey, found ${parsed.allPubkeys.length}`,
		}
	}
	if (parsed.nSigs !== 1) {
		return { ok: false, reason: 'lock_n_sigs_invalid', detail: `n_sigs=${parsed.nSigs}` }
	}
	if (parsed.sigflag !== expectedSigflag) {
		return { ok: false, reason: 'lock_sigflag_invalid', detail: `sigflag=${parsed.sigflag}` }
	}
	if (parsed.locktime === undefined) {
		return { ok: false, reason: 'lock_missing_locktime' }
	}
	if (parsed.locktime !== constraints.expectedLocktime) {
		return {
			ok: false,
			reason: 'lock_locktime_mismatch',
			detail: `expected ${constraints.expectedLocktime}, got ${parsed.locktime}`,
		}
	}
	if (parsed.refundPubkeys.length !== 1) {
		return {
			ok: false,
			reason: 'lock_refund_count_invalid',
			detail: `expected 1 refund key, got ${parsed.refundPubkeys.length}`,
		}
	}
	if (parsed.nSigsRefund !== 1) {
		return { ok: false, reason: 'lock_n_sigs_refund_invalid', detail: `n_sigs_refund=${parsed.nSigsRefund}` }
	}

	if (parsed.pubkey.toLowerCase() !== constraints.expectedChildPubkey.toLowerCase()) {
		return {
			ok: false,
			reason: 'lock_pubkey_mismatch',
			detail: `expected ${constraints.expectedChildPubkey}, got ${parsed.pubkey}`,
		}
	}
	if (parsed.refundPubkeys[0].toLowerCase() !== constraints.expectedRefundPubkey.toLowerCase()) {
		return {
			ok: false,
			reason: 'lock_refund_mismatch',
			detail: `expected ${constraints.expectedRefundPubkey}, got ${parsed.refundPubkeys[0]}`,
		}
	}

	return {
		ok: true,
		value: {
			...parsed,
			locktime: parsed.locktime,
			refundPubkey: parsed.refundPubkeys[0],
		},
	}
}
