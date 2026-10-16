import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bolt11AmountSats, verifyZapReceipt, zapDescriptionHash, ZAP_RECEIPT_KIND, ZAP_REQUEST_KIND } from '../v4v/zapReceipt'

/**
 * Real Schnorr signatures throughout. A test whose happy path passes because signature verification
 * silently failed is worse than no test — that is exactly the bug class this branch has already hit
 * twice — so every fixture is signed with `finalizeEvent` and the negative signature case is produced
 * by corrupting a real one.
 */
const key = (seed: string): Uint8Array => sha256(new TextEncoder().encode(seed))

const recipientKey = key('recipient-seed')
const serverKey = key('server-seed')
const strangerKey = key('stranger-seed')
const recipientPubkey = getPublicKey(recipientKey)
const serverPubkey = getPublicKey(serverKey)

const auctionAnchor = '30408:' + 'a'.repeat(64) + ':auction-1'

/** The zap request the recipient's server would have received, and hashed into the invoice. */
const zapRequest = (overrides: { recipient?: string; kind?: number } = {}) =>
	JSON.stringify({
		kind: overrides.kind ?? ZAP_REQUEST_KIND,
		pubkey: getPublicKey(strangerKey),
		created_at: 1_700_000_000,
		tags: [
			['relays', 'wss://relay.example.com'],
			['amount', '21000'],
			['p', overrides.recipient ?? recipientPubkey],
			['a', auctionAnchor],
		],
		content: 'v4v share',
	})

const receipt = (
	options: {
		tags?: string[][]
		signWith?: Uint8Array
		kind?: number
		corruptSignature?: boolean
	} = {},
) => {
	const signed = finalizeEvent(
		{
			kind: options.kind ?? ZAP_RECEIPT_KIND,
			created_at: 1_700_000_100,
			tags: options.tags ?? [
				['p', recipientPubkey],
				['a', auctionAnchor],
				['bolt11', invoice('1u')],
				['description', zapRequest()],
			],
			content: '',
		},
		options.signWith ?? serverKey,
	)
	if (!options.corruptSignature) return signed
	return { ...signed, sig: '0'.repeat(127) + '1' }
}

/** A well-formed BOLT11 human-readable prefix: `lnbc<amount><separator><data>`. Fixtures that forget
 * the separator are not invoices at all, and testing the parser with them tests the wrong thing. */
const invoice = (amount: string): string => `lnbc${amount}1${'q'.repeat(20)}`

const expected = {
	recipientPubkey,
	recipientServerPubkey: serverPubkey,
	auctionAnchor: { kind: 'a' as const, value: auctionAnchor },
	plannedSats: 100,
}

describe('bolt11AmountSats — the multiplier rules, in the open', () => {
	test('reads millis, micros, nanos and picos', () => {
		expect(bolt11AmountSats(invoice('1m'))).toBe(100_000)
		expect(bolt11AmountSats(invoice('1u'))).toBe(100)
		expect(bolt11AmountSats(invoice('10n'))).toBe(1)
		expect(bolt11AmountSats(invoice('10000p'))).toBe(1)
		// sub-satoshi rounds to zero rather than silently becoming one sat
		expect(bolt11AmountSats(invoice('1000p'))).toBe(0)
	})

	test('reads a whole-bitcoin amount with no multiplier', () => {
		expect(bolt11AmountSats(invoice('21'))).toBe(2_100_000_000)
		expect(bolt11AmountSats(invoice('1'))).toBe(100_000_000)
	})

	test('an amount containing a 1 is still read — the separator is the last 1, not the first', () => {
		// the bug this test was written for: `indexOf('1')` finds the digit in `1u`/`10n`/`1000p`
		expect(bolt11AmountSats(invoice('1u'))).toBe(100)
		expect(bolt11AmountSats(invoice('10n'))).toBe(1)
		expect(bolt11AmountSats(invoice('110n'))).toBe(11)
		expect(bolt11AmountSats(invoice('1000p'))).toBe(0)
	})

	test('an amountless invoice is null, never zero', () => {
		expect(bolt11AmountSats('lnbc1' + 'q'.repeat(30))).toBeNull()
	})

	test('non-invoices and malformed amounts are null', () => {
		expect(bolt11AmountSats('lntb1u1qx')).toBeNull() // wrong currency prefix
		expect(bolt11AmountSats('not an invoice')).toBeNull()
		expect(bolt11AmountSats('lnbcXu1qx')).toBeNull()
		expect(bolt11AmountSats('')).toBeNull()
		// @ts-expect-error — a malformed caller must get null, not a crash
		expect(bolt11AmountSats(null)).toBeNull()
	})

	test('BOLT11 is case-insensitive', () => {
		expect(bolt11AmountSats('LNBC1U1' + 'Q'.repeat(10))).toBe(100)
	})
})

describe('verifyZapReceipt — the happy path', () => {
	test('a receipt signed by the announced server, for this auction and this amount, verifies', () => {
		const result = verifyZapReceipt({ event: receipt(), expected })
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.amountSats).toBe(100)
	})

	test('an e-anchor is accepted as well as an a-coordinate', () => {
		const eventId = 'b'.repeat(64)
		const event = receipt({
			tags: [
				['p', recipientPubkey],
				['e', eventId],
				['bolt11', invoice('1u')],
				['description', zapRequest()],
			],
		})
		expect(verifyZapReceipt({ event, expected: { ...expected, auctionAnchor: { kind: 'e', value: eventId } } })).toMatchObject({ ok: true })
	})

	test('omitting the server expectation skips only that check', () => {
		expect(verifyZapReceipt({ event: receipt(), expected: { ...expected, recipientServerPubkey: undefined } })).toMatchObject({ ok: true })
	})
})

describe('verifyZapReceipt — the worst fact is reported first', () => {
	test('a wrong kind is refused before the signature is even considered', () => {
		expect(verifyZapReceipt({ event: receipt({ kind: 1 }), expected })).toMatchObject({ ok: false, code: 'receipt_kind_mismatch' })
	})

	test('an unverifiable signature is refused before any tag is trusted', () => {
		// the fixture ALSO has a wrong recipient, so a tag-first implementation would report that instead
		const event = receipt({
			corruptSignature: true,
			tags: [
				['p', getPublicKey(strangerKey)],
				['bolt11', invoice('1u')],
			],
		})
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_signature_invalid' })
	})

	test('a receipt signed by someone else is a server mismatch, not a signature failure', () => {
		// the stranger's signature is genuinely valid, so this must NOT be reported as a bad signature:
		// "we cannot trust this event" and "this event is from the wrong publisher" are different facts
		const event = receipt({ signWith: strangerKey })
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_server_mismatch' })
		// with no server expectation the receipt is accepted on its content, which is the documented limit
		expect(verifyZapReceipt({ event, expected: { ...expected, recipientServerPubkey: undefined } }).ok).toBe(true)
	})
})

describe('verifyZapReceipt — content refusals', () => {
	const withTags = (tags: string[][]) => receipt({ tags })

	test('no recipient tag', () => {
		expect(verifyZapReceipt({ event: withTags([['bolt11', invoice('1u')]]), expected })).toMatchObject({
			ok: false,
			code: 'receipt_recipient_missing',
		})
	})

	test('a receipt for a different recipient', () => {
		const event = withTags([
			['p', getPublicKey(strangerKey)],
			['bolt11', invoice('1u')],
		])
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_recipient_mismatch' })
	})

	test('the announced server is what the receipt must come from', () => {
		const fromStranger = receipt({
			signWith: strangerKey,
			tags: [
				['p', recipientPubkey],
				['a', auctionAnchor],
				['bolt11', invoice('1u')],
				['description', zapRequest()],
			],
		})
		expect(verifyZapReceipt({ event: fromStranger, expected })).toMatchObject({ ok: false, code: 'receipt_server_mismatch' })
		const fromServer = receipt({
			tags: [
				['p', recipientPubkey],
				['a', auctionAnchor],
				['bolt11', invoice('1u')],
				['description', zapRequest()],
			],
		})
		expect(verifyZapReceipt({ event: fromServer, expected }).ok).toBe(true)
	})

	test('a receipt that does not reference this auction', () => {
		const event = withTags([
			['p', recipientPubkey],
			['a', '30408:' + 'c'.repeat(64) + ':other-auction'],
			['bolt11', invoice('1u')],
			['description', zapRequest()],
		])
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_anchor_mismatch' })
	})

	test('no bolt11 tag', () => {
		// the anchor is present, so the refusal that fires is the missing invoice and not the anchor
		expect(
			verifyZapReceipt({
				event: withTags([
					['p', recipientPubkey],
					['a', auctionAnchor],
				]),
				expected,
			}),
		).toMatchObject({
			ok: false,
			code: 'receipt_bolt11_missing',
		})
	})

	test('an amountless invoice is unreadable, not free', () => {
		const event = withTags([
			['p', recipientPubkey],
			['a', auctionAnchor],
			['bolt11', 'lnbc1' + 'q'.repeat(30)],
		])
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_amount_unreadable' })
	})

	test('an amount that does not match the committed share', () => {
		const event = withTags([
			['p', recipientPubkey],
			['a', auctionAnchor],
			['bolt11', invoice('2u')],
		])
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_amount_mismatch' })
	})

	test('the rounding allowance is honoured: one sat off passes, two do not', () => {
		const exact = withTags([
			['p', recipientPubkey],
			['a', auctionAnchor],
			['bolt11', invoice('1u')],
			['description', zapRequest()],
		])
		const ninetyNine = withTags([
			['p', recipientPubkey],
			['a', auctionAnchor],
			['bolt11', invoice('990n')],
			['description', zapRequest()],
		])
		expect(verifyZapReceipt({ event: exact, expected }).ok).toBe(true) // 100 for 100
		expect(verifyZapReceipt({ event: ninetyNine, expected: { ...expected, plannedSats: 99 } }).ok).toBe(true) // 99 for 99
		expect(verifyZapReceipt({ event: ninetyNine, expected }).ok).toBe(true) // 99 for 100: within 1
		expect(verifyZapReceipt({ event: ninetyNine, expected: { ...expected, plannedSats: 101 } })).toMatchObject({
			ok: false,
			code: 'receipt_amount_mismatch',
		}) // 99 for 101: two off
		expect(verifyZapReceipt({ event: ninetyNine, expected: { ...expected, roundingToleranceSats: 0 } })).toMatchObject({
			ok: false,
			code: 'receipt_amount_mismatch',
		}) // with no allowance, one sat off is a mismatch
		expect(verifyZapReceipt({ event: exact, expected: { ...expected, roundingToleranceSats: 0 } }).ok).toBe(true) // and exact still exact
	})

	test('no description tag', () => {
		expect(
			verifyZapReceipt({
				event: withTags([
					['p', recipientPubkey],
					['a', auctionAnchor],
					['bolt11', invoice('1u')],
				]),
				expected,
			}),
		).toMatchObject({ ok: false, code: 'receipt_description_missing' })
	})

	test('a description that is not JSON', () => {
		const event = withTags([
			['p', recipientPubkey],
			['a', auctionAnchor],
			['bolt11', invoice('1u')],
			['description', 'not json'],
		])
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_description_invalid' })
	})

	test('a description that is JSON but not a zap request', () => {
		const event = withTags([
			['p', recipientPubkey],
			['a', auctionAnchor],
			['bolt11', invoice('1u')],
			['description', zapRequest({ kind: 1 })],
		])
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_description_invalid' })
	})

	test('a zap request inside the receipt addressed to a different recipient', () => {
		const event = withTags([
			['p', recipientPubkey],
			['a', auctionAnchor],
			['bolt11', invoice('1u')],
			['description', zapRequest({ recipient: getPublicKey(strangerKey) })],
		])
		expect(verifyZapReceipt({ event, expected })).toMatchObject({ ok: false, code: 'receipt_description_invalid' })
	})
})

describe('zapDescriptionHash', () => {
	test('is sha256 of the description, in hex, deterministically', () => {
		const description = zapRequest()
		const expectedHash = Array.from(sha256(new TextEncoder().encode(description)))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('')
		expect(zapDescriptionHash(description)).toBe(expectedHash)
		expect(zapDescriptionHash(description)).toHaveLength(64)
		expect(zapDescriptionHash(description)).toBe(zapDescriptionHash(description))
	})

	test('changes when the description changes', () => {
		expect(zapDescriptionHash(zapRequest())).not.toBe(zapDescriptionHash(zapRequest({ recipient: 'x' })))
	})
})
