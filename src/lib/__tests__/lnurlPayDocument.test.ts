import { describe, expect, test } from 'bun:test'
import { buildInvoiceRequestUrl, parseLnurlPayDocument, readInvoiceFromResponse } from '../v4v/lnurlPayDocument'

const document = (overrides: Record<string, unknown> = {}) => ({
	tag: 'payRequest',
	callback: 'https://pay.example.com/lnurlp/alice/callback',
	minSendable: 1000,
	maxSendable: 100_000_000,
	metadata: '[[\"text/plain\",\"Alice\"]]',
	allowsNostr: true,
	nostrPubkey: 'a'.repeat(64),
	...overrides,
})

describe('parseLnurlPayDocument — a payout decides money from this, so it is fail-closed', () => {
	test('a well-formed document parses', () => {
		const result = parseLnurlPayDocument(document())
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document).toMatchObject({
			callback: 'https://pay.example.com/lnurlp/alice/callback',
			minSendableMsat: 1000,
			maxSendableMsat: 100_000_000,
			allowsNostr: true,
			nostrPubkey: 'a'.repeat(64),
		})
	})

	test('a plain Lightning address endpoint (no NIP-57) parses, with allowsNostr false', () => {
		const result = parseLnurlPayDocument(document({ allowsNostr: false, nostrPubkey: undefined }))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.allowsNostr).toBe(false)
		expect(result.document.nostrPubkey).toBeUndefined()
	})

	test('a non-object answer is refused', () => {
		expect(parseLnurlPayDocument('nope')).toMatchObject({ ok: false, code: 'lnurl_not_object' })
		expect(parseLnurlPayDocument(null)).toMatchObject({ ok: false, code: 'lnurl_not_object' })
		// @ts-expect-error — untrusted input reaches this
		expect(parseLnurlPayDocument(undefined)).toMatchObject({ ok: false, code: 'lnurl_not_object' })
	})

	test('a different LNURL kind is refused rather than paid as a zap', () => {
		expect(parseLnurlPayDocument(document({ tag: 'withdrawRequest' }))).toMatchObject({ ok: false, code: 'lnurl_wrong_tag' })
		expect(parseLnurlPayDocument(document({ tag: undefined }))).toMatchObject({ ok: false, code: 'lnurl_wrong_tag' })
	})

	test('a missing callback is refused', () => {
		expect(parseLnurlPayDocument(document({ callback: undefined }))).toMatchObject({ ok: false, code: 'lnurl_missing_callback' })
		expect(parseLnurlPayDocument(document({ callback: 'not a url' }))).toMatchObject({ ok: false, code: 'lnurl_missing_callback' })
	})

	test('a plain-http callback is refused as an insecure downgrade', () => {
		const result = parseLnurlPayDocument(document({ callback: 'http://pay.example.com/callback' }))
		expect(result).toMatchObject({ ok: false, code: 'lnurl_insecure_callback' })
		// and a non-http scheme is not mistaken for an insecure one
		expect(parseLnurlPayDocument(document({ callback: 'javascript:alert(1)' }))).toMatchObject({
			ok: false,
			code: 'lnurl_missing_callback',
		})
	})

	test('limits must be finite non-negative integers with a payable range', () => {
		for (const bad of [
			{ minSendable: -1 },
			{ minSendable: 1.5 },
			{ maxSendable: '1000' },
			{ maxSendable: 0 },
			{ minSendable: 2000, maxSendable: 1000 },
		]) {
			expect(parseLnurlPayDocument(document(bad))).toMatchObject({ ok: false, code: 'lnurl_invalid_limits' })
		}
	})

	test('claiming zaps without a usable nostrPubkey is refused — no receipt could ever be verified', () => {
		expect(parseLnurlPayDocument(document({ nostrPubkey: undefined }))).toMatchObject({ ok: false, code: 'lnurl_inconsistent_nostr' })
		expect(parseLnurlPayDocument(document({ nostrPubkey: 'short' }))).toMatchObject({ ok: false, code: 'lnurl_inconsistent_nostr' })
		expect(parseLnurlPayDocument(document({ nostrPubkey: 'Z'.repeat(64) }))).toMatchObject({ ok: false, code: 'lnurl_inconsistent_nostr' })
	})

	test('a declared nostrPubkey is normalised to lowercase', () => {
		const result = parseLnurlPayDocument(document({ nostrPubkey: 'A'.repeat(64) }))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.nostrPubkey).toBe('a'.repeat(64))
	})

	test('an endpoint that forbids zaps but declares a key keeps the key — the key is presentation, the flag decides', () => {
		const result = parseLnurlPayDocument(document({ allowsNostr: false }))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.allowsNostr).toBe(false)
		expect(result.document.nostrPubkey).toBe('a'.repeat(64))
	})
})

describe('buildInvoiceRequestUrl', () => {
	test('asks for the amount in millisats', () => {
		const url = buildInvoiceRequestUrl({ callback: 'https://pay.example.com/cb', amountSats: 100 })
		expect(url).toContain('amount=100000')
	})

	test('carries the zap request so the server can put it in the receipt', () => {
		const url = buildInvoiceRequestUrl({ callback: 'https://pay.example.com/cb', amountSats: 1, zapRequestJson: '{"kind":9734}' })
		expect(url).toContain('nostr=%7B%22kind%22%3A9734%7D')
		expect(new URL(url).searchParams.get('nostr')).toBe('{"kind":9734}')
	})

	test('preserves a query string the callback already carries', () => {
		const url = buildInvoiceRequestUrl({ callback: 'https://pay.example.com/cb?k1=abc', amountSats: 50 })
		const parsed = new URL(url)
		expect(parsed.searchParams.get('k1')).toBe('abc')
		expect(parsed.searchParams.get('amount')).toBe('50000')
	})

	test('adds a comment only when there is one', () => {
		expect(buildInvoiceRequestUrl({ callback: 'https://pay.example.com/cb', amountSats: 1 })).not.toContain('comment=')
		expect(buildInvoiceRequestUrl({ callback: 'https://pay.example.com/cb', amountSats: 1, comment: 'v4v' })).toContain('comment=v4v')
	})
})

describe('readInvoiceFromResponse — also untrusted', () => {
	test('reads the invoice', () => {
		expect(readInvoiceFromResponse({ pr: 'lnbc1u1qx' })).toMatchObject({ ok: true, bolt11: 'lnbc1u1qx' })
	})

	test("a response with no invoice is a failure that carries the endpoint's reason", () => {
		const result = readInvoiceFromResponse({ status: 'ERROR', reason: 'amount too small' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.detail).toContain('amount too small')
	})

	test('a non-object or empty invoice is refused', () => {
		expect(readInvoiceFromResponse(null)).toMatchObject({ ok: false })
		expect(readInvoiceFromResponse({ pr: '' })).toMatchObject({ ok: false })
		expect(readInvoiceFromResponse({ pr: 42 })).toMatchObject({ ok: false })
	})
})
