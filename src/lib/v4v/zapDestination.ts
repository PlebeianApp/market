/**
 * A V4V row's Lightning destination — §5 of the zap-payout packet.
 *
 * Three accepted forms, all of which resolve to an LNURL-pay endpoint at payout time:
 *
 *   `lud16`  `name@domain`   → `https://domain/.well-known/lnurlp/name`
 *   `lnurl`  `lnurl1…`       → the bech32-decoded URL
 *   `npub`   `npub1…`        → a zap-enabled identity, whose address is its profile's `lud16`/`lud06`
 *
 * ## What is decided here and what is not
 *
 * Everything in this module is **local and fail-closed**: shape, scheme, checksum, key length. It is
 * the check that can be made without a network, and it is the check that must happen before a row is
 * ever committed to.
 *
 * What an endpoint actually *is* — whether it answers at all, whether it supports NIP-57
 * (`allowsNostr` + `nostrPubkey`), and what its `minSendable`/`maxSendable` are — is a **runtime fact
 * discovered at payout**, and it can change between announcement and settlement. This module
 * deliberately does not pretend otherwise; that is what the ledger's statuses are for.
 *
 * An `npub` has no LNURL-pay endpoint until its profile is read, so `zapDestinationLnurlpEndpoint`
 * returns `null` for it rather than an empty string or a fabricated URL — a caller that receives
 * `null` must do the profile read, and a silent `''` would instead have become a request to nowhere.
 */

import { bech32 } from '@scure/base'
import { nip19 } from 'nostr-tools'

export type ZapDestinationKind = 'lud16' | 'lnurl' | 'npub'

export interface ZapDestination {
	/** Which of the three forms the input was. */
	readonly kind: ZapDestinationKind
	/** The input, trimmed, as the user wrote it. */
	readonly raw: string
	/** The canonical form used for commitment and duplicate detection. */
	readonly normalized: string
}

/**
 * Announcement-time refusals (§8). Stable strings, safe to branch on and safe to show.
 *
 * `destination_duplicate` is not produced here: it is a property of the whole split, not of one
 * entry, and `findDuplicateZapDestinations` is where it is decided.
 */
export type ZapDestinationRefusal = 'destination_malformed' | 'destination_unsupported_scheme'

export type ZapDestinationParseResult =
	| { readonly ok: true; readonly destination: ZapDestination }
	| { readonly ok: false; readonly code: ZapDestinationRefusal; readonly detail: string }

/** A `lud16` local part: letters, digits, and the separators mail-style addresses allow. */
const LUD16_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
/** A domain that could plausibly resolve: labels of letters/digits/hyphens, at least one dot. */
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

const decodeLnurl = (input: string): { ok: true; url: string } | { ok: false; detail: string } => {
	let words: number[]
	try {
		// LNURL strings routinely exceed bech32's 90-character default limit, so the limit is raised
		// explicitly rather than silently rejecting every long (and therefore real) endpoint.
		words = bech32.decode(input as `${string}1${string}`, 2000).words
	} catch (error) {
		return { ok: false, detail: `the lnurl string does not decode as bech32 (${error instanceof Error ? error.message : 'unknown error'})` }
	}
	try {
		const url = new TextDecoder().decode(Uint8Array.from(bech32.fromWords(words)))
		return { ok: true, url }
	} catch {
		return { ok: false, detail: 'the lnurl payload is not valid UTF-8' }
	}
}

/** Canonicalise a URL for comparison: lowercase host, no trailing slash, path preserved. */
const normalizeUrl = (url: string): string | null => {
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
		const path = parsed.pathname.replace(/\/+$/, '')
		return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`
	} catch {
		return null
	}
}

/**
 * Parse and validate one destination. Local, fail-closed, no network.
 *
 * The order is scheme-first: an input that is not one of the three forms is `unsupported_scheme`, and
 * only an input that *is* one of them can be `malformed` — so the message a user sees names the real
 * problem (a `bitcoin:` URI is not a typo'd address).
 */
export const parseZapDestination = (input: unknown): ZapDestinationParseResult => {
	if (typeof input !== 'string') {
		return { ok: false, code: 'destination_malformed', detail: 'the destination is not a string' }
	}
	const raw = input.trim()
	if (!raw) return { ok: false, code: 'destination_malformed', detail: 'the destination is empty' }
	const lower = raw.toLowerCase()

	if (lower.startsWith('lud16:')) {
		return { ok: false, code: 'destination_unsupported_scheme', detail: 'write the address as name@domain, without the lud16: scheme' }
	}
	if (lower.startsWith('lnurl1')) {
		const decoded = decodeLnurl(lower)
		if (!decoded.ok) return { ok: false, code: 'destination_malformed', detail: decoded.detail }
		const normalized = normalizeUrl(decoded.url)
		if (!normalized) {
			return {
				ok: false,
				code: 'destination_unsupported_scheme',
				detail: `the lnurl encodes ${decoded.url}, which is not an http(s) URL`,
			}
		}
		return { ok: true, destination: { kind: 'lnurl', raw, normalized } }
	}
	if (lower.startsWith('npub1')) {
		try {
			const decoded = nip19.decode(lower)
			if (decoded.type !== 'npub') {
				return { ok: false, code: 'destination_malformed', detail: 'the npub does not decode to a public key' }
			}
			// nostr-tools' decoder hands back the key as a 64-character hex string in this version, not
			// as bytes. Accepting both shapes is deliberate: an assumption about which one it is was
			// exactly how an earlier version of this code rejected every valid npub.
			const data: unknown = decoded.data
			const isKey = (typeof data === 'string' && /^[0-9a-f]{64}$/.test(data)) || (data instanceof Uint8Array && data.length === 32)
			if (!isKey) {
				return { ok: false, code: 'destination_malformed', detail: 'the npub does not decode to a 32-byte public key' }
			}
			return { ok: true, destination: { kind: 'npub', raw, normalized: lower } }
		} catch (error) {
			return {
				ok: false,
				code: 'destination_malformed',
				detail: `the npub is not valid bech32 (${error instanceof Error ? error.message : 'unknown error'})`,
			}
		}
	}
	// A URI carries a scheme, and a scheme means the input is not an address — decided before the '@'
	// test below, so `mailto:alice@example.com` is named an unsupported scheme rather than being read
	// as an address whose name happens to contain a colon.
	if (/^[a-z][a-z0-9+.-]*:/.test(lower)) {
		return {
			ok: false,
			code: 'destination_unsupported_scheme',
			detail: 'expected name@domain, an lnurl1… string, or an npub1… identity',
		}
	}
	if (lower.includes('@')) {
		const [name, domain, ...rest] = lower.split('@')
		if (rest.length > 0) return { ok: false, code: 'destination_malformed', detail: 'a lud16 address has exactly one @' }
		if (!LUD16_NAME.test(name)) return { ok: false, code: 'destination_malformed', detail: `"${name}" is not a valid address name` }
		if (!DOMAIN.test(domain)) return { ok: false, code: 'destination_malformed', detail: `"${domain}" is not a valid domain` }
		return { ok: true, destination: { kind: 'lud16', raw, normalized: `${name}@${domain}` } }
	}

	return {
		ok: false,
		code: 'destination_unsupported_scheme',
		detail: 'expected name@domain, an lnurl1… string, or an npub1… identity',
	}
}

/**
 * The LNURL-pay endpoint to fetch, or `null` when the destination does not have one yet.
 *
 * Only the `npub` case returns `null`, and it is the honest answer: the address lives in the
 * identity's kind-0 profile, so a caller must read it before it can be fetched.
 */
export const zapDestinationLnurlpEndpoint = (destination: ZapDestination): string | null => {
	if (destination.kind === 'lnurl') return destination.normalized
	if (destination.kind === 'lud16') {
		const [name, domain] = destination.normalized.split('@')
		return `https://${domain}/.well-known/lnurlp/${name}`
	}
	return null
}

/** The canonical form, or `null` when the input is not a valid destination. */
export const normalizeZapDestination = (input: string): string | null => {
	const parsed = parseZapDestination(input)
	return parsed.ok ? parsed.destination.normalized : null
}

/**
 * Whether two spellings name the same destination.
 *
 * Deliberately strict: two inputs that cannot be normalised are **not** the same destination, even if
 * their raw strings match — accepting an unparseable pair as "equal" would let a malformed row dodge
 * the duplicate check.
 */
export const sameZapDestination = (a: string, b: string): boolean => {
	const left = normalizeZapDestination(a)
	const right = normalizeZapDestination(b)
	return left !== null && right !== null && left === right
}

/**
 * The destinations announced more than once (§8's `destination_duplicate`), as the normalized forms.
 *
 * A split that names one recipient twice is refused rather than merged: two rows for one destination
 * would mean two zaps, two receipts, and a commitment that says something the seller did not mean.
 */
export const findDuplicateZapDestinations = (destinations: readonly string[]): string[] => {
	const seen = new Set<string>()
	const duplicates = new Set<string>()
	for (const raw of destinations) {
		const normalized = normalizeZapDestination(raw)
		if (normalized === null) continue
		if (seen.has(normalized)) duplicates.add(normalized)
		seen.add(normalized)
	}
	return [...duplicates]
}
