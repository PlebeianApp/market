import { describe, expect, test } from 'bun:test'
import {
	assertLnurlAllowsNostr,
	buildLnurlPayUrl,
	buildProviderZapReceiptFilter,
	parseProfileLud16,
	parseProviderZapReceipt,
	readBolt11AmountMillisats,
	sortZapReceiptsNewestFirst,
	type LnurlPayResponse,
} from './zapRead'

// 20u (2000 sat) sample invoice from light-bolt11-decoder's test suite.
const BOLT11_20U =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'
// Same payload re-encoded without an amount.
const BOLT11_NO_AMOUNT =
	'lnbc1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvspp9vfs9'

const PROVIDER = 'p'.repeat(64)
const RECIPIENT = 'r'.repeat(64)
const SENDER = 's'.repeat(64)

const receipt = (tags: string[][], overrides: Partial<{ id: string; created_at: number; content: string }> = {}) => ({
	id: overrides.id ?? 'zap-id',
	pubkey: PROVIDER,
	kind: 9735,
	content: overrides.content ?? 'great shirt',
	tags,
	created_at: overrides.created_at,
})

describe('lud16 / LNURL helpers', () => {
	test('parseProfileLud16 reads lud16 or null, throws on invalid JSON', () => {
		expect(parseProfileLud16('{"lud16":"alice@example.com"}')).toBe('alice@example.com')
		expect(parseProfileLud16('{"lud16":""}')).toBeNull()
		expect(parseProfileLud16('{}')).toBeNull()
		expect(() => parseProfileLud16('not json')).toThrow()
		expect(() => parseProfileLud16('null')).toThrow()
	})

	test('buildLnurlPayUrl builds the well-known URL and rejects malformed lud16', () => {
		expect(buildLnurlPayUrl('alice@example.com')).toBe('https://example.com/.well-known/lnurlp/alice')
		expect(() => buildLnurlPayUrl('alice')).toThrow('Invalid lud16 format')
		expect(() => buildLnurlPayUrl('@example.com')).toThrow('Invalid lud16 format')
	})

	test('assertLnurlAllowsNostr requires allowsNostr and nostrPubkey', () => {
		const ok = { allowsNostr: true, nostrPubkey: PROVIDER } as LnurlPayResponse
		expect(assertLnurlAllowsNostr(ok, 'a@b')).toBe(ok)
		expect(() => assertLnurlAllowsNostr({ ...ok, allowsNostr: false }, 'a@b')).toThrow('LNURL for a@b does not support Nostr zaps')
		expect(() => assertLnurlAllowsNostr({ ...ok, nostrPubkey: '' }, 'a@b')).toThrow()
	})
})

describe('buildProviderZapReceiptFilter', () => {
	test('adds #e only when a target event id is given', () => {
		expect(buildProviderZapReceiptFilter({ providerPubkey: PROVIDER, recipientPubkey: RECIPIENT })).toEqual({
			kinds: [9735],
			authors: [PROVIDER],
			limit: 100,
			'#p': [RECIPIENT],
		})
		expect(buildProviderZapReceiptFilter({ providerPubkey: PROVIDER, recipientPubkey: RECIPIENT, targetEventId: 'ev' })['#e']).toEqual([
			'ev',
		])
	})
})

describe('readBolt11AmountMillisats', () => {
	test('returns the amount claimed by the invoice, undefined without one, throws on garbage', () => {
		expect(readBolt11AmountMillisats(BOLT11_20U)).toBe('2000000')
		expect(readBolt11AmountMillisats(BOLT11_NO_AMOUNT)).toBeUndefined()
		expect(() => readBolt11AmountMillisats('')).toThrow()
	})
})

describe('parseProviderZapReceipt', () => {
	test('reads sender, bolt11, description hash, target and provider', () => {
		const event = receipt(
			[
				['P', SENDER],
				['p', RECIPIENT],
				['e', 'zapped-event'],
				['bolt11', BOLT11_20U, 'desc-hash'],
			],
			{ created_at: 42 },
		)
		expect(parseProviderZapReceipt(event, { recipientPubkey: RECIPIENT, targetEventId: 'fallback' })).toEqual({
			id: 'zap-id',
			amountMillisats: 2_000_000,
			message: 'great shirt',
			senderPubkey: SENDER,
			recipientPubkey: RECIPIENT,
			targetEventId: 'zapped-event',
			bolt11: BOLT11_20U,
			createdAt: 42,
			rawEvent: event,
			providerPubkey: PROVIDER,
			descriptionHash: 'desc-hash',
		})
	})

	test('defaults: missing P, e, description hash and created_at', () => {
		const zap = parseProviderZapReceipt(receipt([['bolt11', BOLT11_20U]]), { recipientPubkey: RECIPIENT, targetEventId: 'fallback' })
		expect(zap).toMatchObject({ senderPubkey: '', targetEventId: 'fallback', descriptionHash: '', createdAt: 0 })
	})

	test('returns null without an invoice amount and throws when bolt11 is missing or undecodable', () => {
		expect(parseProviderZapReceipt(receipt([['bolt11', BOLT11_NO_AMOUNT]]), { recipientPubkey: RECIPIENT })).toBeNull()
		expect(() => parseProviderZapReceipt(receipt([]), { recipientPubkey: RECIPIENT })).toThrow()
		expect(() => parseProviderZapReceipt(receipt([['bolt11', 'lnbcgarbage']]), { recipientPubkey: RECIPIENT })).toThrow()
	})
})

describe('sortZapReceiptsNewestFirst', () => {
	test('newest first', () => {
		expect(sortZapReceiptsNewestFirst([{ createdAt: 1 }, { createdAt: 3 }, { createdAt: 2 }]).map((z) => z.createdAt)).toEqual([3, 2, 1])
	})
})
