import { describe, expect, test } from 'bun:test'
import { bech32 } from '@scure/base'
import { nip19 } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { sha256 } from '@noble/hashes/sha2.js'
import {
	findDuplicateZapDestinations,
	normalizeZapDestination,
	parseZapDestination,
	sameZapDestination,
	zapDestinationLnurlpEndpoint,
} from '../v4v/zapDestination'

/**
 * Real encodings only. `bech32` and `nip19` are the oracles: an lnurl fixture is *built* by an
 * independent encoder and an npub by nostr-tools, so a passing test cannot be the module agreeing
 * with a string this file invented.
 */
const encodeLnurl = (url: string): string => bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 2000)

// A real key, not an invented one: an all-zero x-only coordinate is not a valid curve point, and
// nostr-tools' decoder rejects it — so a fixture built from zeros tests the refuser, not the parser.
const realNpub = nip19.npubEncode(getPublicKey(sha256(new TextEncoder().encode('zap-destination-test-seed'))))

describe('parseZapDestination — the three accepted forms', () => {
	test('a lud16 address parses and normalises to lowercase', () => {
		const result = parseZapDestination('  Alice@Example.COM ')
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.destination.kind).toBe('lud16')
		expect(result.destination.normalized).toBe('alice@example.com')
		// the raw spelling is preserved, so the UI can echo back what the seller typed
		expect(result.destination.raw).toBe('Alice@Example.COM')
	})

	test('a real bech32 lnurl parses to its URL', () => {
		const lnurl = encodeLnurl('https://pay.example.com/lnurlp/alice')
		const result = parseZapDestination(lnurl)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.destination.kind).toBe('lnurl')
		expect(result.destination.normalized).toBe('https://pay.example.com/lnurlp/alice')
	})

	test('an lnurl longer than 90 characters still decodes (the bech32 default limit is raised)', () => {
		const long = `https://pay.example.com/lnurlp/${'a'.repeat(120)}`
		const result = parseZapDestination(encodeLnurl(long))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.destination.normalized).toBe(long)
	})

	test('a real npub parses as an identity', () => {
		const result = parseZapDestination(realNpub.toUpperCase())
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.destination.kind).toBe('npub')
		expect(result.destination.normalized).toBe(realNpub)
	})
})

describe('parseZapDestination — refusals are fail-closed', () => {
	test('an empty or non-string destination is malformed', () => {
		expect(parseZapDestination('   ')).toMatchObject({ ok: false, code: 'destination_malformed' })
		expect(parseZapDestination(undefined)).toMatchObject({ ok: false, code: 'destination_malformed' })
	})

	test('a name@domain with no dotted domain is malformed, not an address', () => {
		expect(parseZapDestination('alice@localhost')).toMatchObject({ ok: false, code: 'destination_malformed' })
		expect(parseZapDestination('alice@example')).toMatchObject({ ok: false, code: 'destination_malformed' })
	})

	test('two @ signs are malformed', () => {
		expect(parseZapDestination('a@b@example.com')).toMatchObject({ ok: false, code: 'destination_malformed' })
	})

	test('an unsupported scheme is named as such, not as a typo', () => {
		for (const input of ['bitcoin:bc1qxyz', 'lightning:lnbc1u1xyz', 'mailto:alice@example.com', 'https://example.com/pay']) {
			expect(parseZapDestination(input)).toMatchObject({ ok: false, code: 'destination_unsupported_scheme' })
		}
	})

	test('a lud16: scheme prefix is refused with advice rather than accepted', () => {
		const result = parseZapDestination('lud16:alice@example.com')
		expect(result).toMatchObject({ ok: false, code: 'destination_unsupported_scheme' })
	})

	test('an lnurl with a broken checksum is malformed', () => {
		const broken = `${encodeLnurl('https://pay.example.com/lnurlp/alice').slice(0, -1)}q`
		expect(parseZapDestination(broken)).toMatchObject({ ok: false, code: 'destination_malformed' })
	})

	test('an lnurl that decodes to a non-http URL is refused as an unsupported scheme', () => {
		const result = parseZapDestination(encodeLnurl('ftp://files.example.com/pay'))
		expect(result).toMatchObject({ ok: false, code: 'destination_unsupported_scheme' })
	})

	test('an npub that is not a 32-byte key is malformed', () => {
		// a valid bech32 string carrying 20 bytes under the npub prefix
		const short = bech32.encode('npub', bech32.toWords(new Uint8Array(20)))
		expect(parseZapDestination(short)).toMatchObject({ ok: false, code: 'destination_malformed' })
	})

	test('a valid-looking bech32 with the wrong prefix is not accepted as an npub', () => {
		const note = nip19.noteEncode('1'.repeat(64))
		expect(parseZapDestination(note)).toMatchObject({ ok: false, code: 'destination_unsupported_scheme' })
	})
})

describe('zapDestinationLnurlpEndpoint', () => {
	test('a lud16 becomes the well-known endpoint', () => {
		const parsed = parseZapDestination('Alice@Example.com')
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(zapDestinationLnurlpEndpoint(parsed.destination)).toBe('https://example.com/.well-known/lnurlp/alice')
	})

	test('an lnurl is already the endpoint', () => {
		const parsed = parseZapDestination(encodeLnurl('https://pay.example.com/lnurlp/alice'))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(zapDestinationLnurlpEndpoint(parsed.destination)).toBe('https://pay.example.com/lnurlp/alice')
	})

	test('an npub has no endpoint until its profile is read — null, never an empty string', () => {
		const parsed = parseZapDestination(realNpub)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(zapDestinationLnurlpEndpoint(parsed.destination)).toBeNull()
	})
})

describe('normalisation, sameness and duplicates', () => {
	test('two spellings of one lud16 normalise together', () => {
		expect(normalizeZapDestination(' ALICE@Example.com ')).toBe('alice@example.com')
		expect(sameZapDestination('Alice@example.com', 'alice@EXAMPLE.com')).toBe(true)
	})

	test('a trailing slash does not make two lnurls different', () => {
		const a = encodeLnurl('https://pay.example.com/lnurlp/alice')
		const b = encodeLnurl('https://pay.example.com/lnurlp/alice/')
		expect(sameZapDestination(a, b)).toBe(true)
	})

	test('different kinds are never the same destination', () => {
		expect(sameZapDestination('alice@example.com', realNpub)).toBe(false)
	})

	test('an unparseable destination is never equal to anything, even itself', () => {
		// strictness matters here: lenient sameness would let a malformed row dodge the duplicate check
		expect(sameZapDestination('not a destination', 'not a destination')).toBe(false)
		expect(normalizeZapDestination('not a destination')).toBeNull()
	})

	test('findDuplicateZapDestinations reports the repeated destination once', () => {
		const duplicates = findDuplicateZapDestinations(['Alice@example.com', 'alice@EXAMPLE.com', 'bob@example.com'])
		expect(duplicates).toEqual(['alice@example.com'])
	})

	test('findDuplicateZapDestinations ignores unparseable rows and reports nothing when all are distinct', () => {
		expect(findDuplicateZapDestinations(['alice@example.com', 'bob@example.com', 'not a destination'])).toEqual([])
	})
})
