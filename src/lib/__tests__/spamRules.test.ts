import { beforeEach, describe, expect, test } from 'bun:test'
import { NDKEvent } from '@/lib/nostr/ndk-events'
import { blacklistActions } from '@/lib/stores/blacklist'
import { filterBlacklistedEvents, isProductEventBlacklisted } from '@/lib/utils/blacklistFilters'
import { isSpamProduct } from '@/lib/utils/spamRules'

const product = (kind: number, tags: string[][], pubkey = 'a'.repeat(64)) =>
	new NDKEvent(undefined, {
		id: '0'.repeat(64),
		pubkey,
		created_at: 1_700_000_000,
		kind,
		tags,
		content: '',
		sig: '0'.repeat(128),
	})

const spamTags = (title = 'journey widget', amount = '700', currency = 'SAT') => [
	['d', 'spam-1'],
	['title', title],
	['price', amount, currency],
]

describe('isSpamProduct', () => {
	test('matches the journey widget spam template', () => {
		expect(isSpamProduct(product(30402, spamTags()))).toBe(true)
	})

	test('does not match a different amount', () => {
		expect(isSpamProduct(product(30402, spamTags('journey widget', '701')))).toBe(false)
	})

	test('does not match a different currency', () => {
		expect(isSpamProduct(product(30402, spamTags('journey widget', '700', 'USD')))).toBe(false)
	})

	test('does not match a differently-cased title', () => {
		expect(isSpamProduct(product(30402, spamTags('Journey Widget')))).toBe(false)
	})

	test('does not match when the price tag is missing', () => {
		expect(
			isSpamProduct(
				product(30402, [
					['d', 'x'],
					['title', 'journey widget'],
				]),
			),
		).toBe(false)
	})

	test('does not match non-product kinds', () => {
		expect(isSpamProduct(product(30405, spamTags()))).toBe(false)
		expect(isSpamProduct(product(1, spamTags()))).toBe(false)
	})
})

describe('blacklistFilters spam integration', () => {
	beforeEach(() => blacklistActions.clearBlacklist())

	test('hides spam while the blacklist is NOT loaded', () => {
		expect(blacklistActions.isBlacklistLoaded()).toBe(false)

		const out = filterBlacklistedEvents([product(30402, spamTags()), product(30402, spamTags('real product', '10'))])

		expect(out).toHaveLength(1)
		expect(out[0].tags.find((tag) => tag[0] === 'title')?.[1]).toBe('real product')
	})

	test('hides spam after the blacklist is loaded', () => {
		blacklistActions.setBlacklist({
			blacklistedPubkeys: [],
			blacklistedProducts: [],
			blacklistedCollections: [],
		})
		expect(blacklistActions.isBlacklistLoaded()).toBe(true)

		const out = filterBlacklistedEvents([product(30402, spamTags()), product(30402, spamTags('real product', '10'))])

		expect(out).toHaveLength(1)
		expect(out[0].tags.find((tag) => tag[0] === 'title')?.[1]).toBe('real product')
	})

	test('isProductEventBlacklisted returns true for spam and false otherwise', () => {
		expect(isProductEventBlacklisted(product(30402, spamTags()))).toBe(true)
		expect(isProductEventBlacklisted(product(30402, spamTags('real product', '10')))).toBe(false)
	})
})
