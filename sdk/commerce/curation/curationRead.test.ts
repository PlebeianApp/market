import { describe, expect, test } from 'bun:test'
import {
	buildBlacklistFilter,
	buildCurationListFilter,
	getFormattedAdmins,
	getFormattedBlacklist,
	getFormattedEditors,
	getUserRoleForPubkey,
	isAdmin,
	isBlacklisted,
	isEditor,
	isOwner,
	parseAdminSettings,
	parseBlacklistSettings,
	parseEditorSettings,
	parseFeaturedAuctions,
	parseFeaturedCollections,
	parseFeaturedProducts,
	parseFeaturedUsers,
} from './curationRead'
import {
	buildVanityRegistryFilter,
	getExpiredVanityForPubkey,
	getVanityForPubkey,
	isVanityAvailable,
	parseVanitySettings,
	resolveVanity,
} from './vanityRead'

const APP = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)
const CAROL = 'd'.repeat(64)
const keep = (items: string[]) => items

const event = (tags: string[][], created_at?: number) => ({ tags, created_at })

describe('curation filters', () => {
	test('list filters use CURATION_LISTS kind and d-tag', () => {
		expect(buildCurationListFilter('admins', APP)).toEqual({ kinds: [30000], authors: [APP], '#d': ['admins'] })
		expect(buildCurationListFilter('editors', APP)).toEqual({ kinds: [30000], authors: [APP], '#d': ['editors'] })
		expect(buildCurationListFilter('featuredProducts', APP)).toEqual({ kinds: [30405], authors: [APP], '#d': ['featured_products'] })
		expect(buildCurationListFilter('featuredCollections', APP)).toEqual({ kinds: [30003], authors: [APP], '#d': ['featured_collections'] })
		expect(buildCurationListFilter('featuredAuctions', APP)).toEqual({ kinds: [30409], authors: [APP], '#d': ['featured_auctions'] })
		expect(buildCurationListFilter('featuredUsers', APP)).toEqual({ kinds: [30000], authors: [APP], '#d': ['featured_users'] })
	})

	test('blacklist filter is the NIP-51 mute list without a d-tag', () => {
		expect(buildBlacklistFilter(APP)).toEqual({ kinds: [10000], authors: [APP] })
	})
})

describe('admin and editor settings', () => {
	test('admins come from p tags in order; first admin is the owner', () => {
		const ev = event(
			[
				['d', 'admins'],
				['p', ALICE],
				['e', 'x'],
				['p', ''],
				['p', BOB],
			],
			100,
		)
		const settings = parseAdminSettings(ev, APP)
		expect(settings).toEqual({ admins: [ALICE, BOB], owner: ALICE, lastUpdated: 100, event: ev })
	})

	test('owner falls back to app pubkey and lastUpdated to 0', () => {
		expect(parseAdminSettings(event([['d', 'admins']]), APP)).toMatchObject({ admins: [], owner: APP, lastUpdated: 0 })
	})

	test('missing editor event yields an empty list', () => {
		expect(parseEditorSettings(null)).toEqual({ editors: [], lastUpdated: 0, event: null })
		expect(parseEditorSettings(event([['p', CAROL]], 5))).toMatchObject({ editors: [CAROL], lastUpdated: 5 })
	})

	test('role helpers', () => {
		const admins = parseAdminSettings(
			event([
				['p', ALICE],
				['p', BOB],
			]),
			APP,
		)
		const editors = parseEditorSettings(event([['p', CAROL]]))
		expect(isOwner(admins, ALICE)).toBe(true)
		expect(isOwner(admins, BOB)).toBe(false)
		expect(isAdmin(admins, BOB)).toBe(true)
		expect(isAdmin(admins, '')).toBe(false)
		expect(isAdmin(null, ALICE)).toBe(false)
		expect(isEditor(editors, CAROL)).toBe(true)
		expect(isEditor(undefined, CAROL)).toBe(false)
		expect(getUserRoleForPubkey(admins, editors, ALICE)).toBe('owner')
		expect(getUserRoleForPubkey(admins, editors, BOB)).toBe('admin')
		expect(getUserRoleForPubkey(admins, editors, CAROL)).toBe('editor')
		expect(getUserRoleForPubkey(null, null, APP)).toBe('user')
		expect(getFormattedAdmins(admins)).toEqual([
			{ pubkey: ALICE, isOwner: true, index: 0 },
			{ pubkey: BOB, isOwner: false, index: 1 },
		])
		expect(getFormattedAdmins(null)).toEqual([])
		expect(getFormattedEditors(editors)).toEqual([{ pubkey: CAROL, role: 'editor' }])
		expect(getFormattedEditors(undefined)).toEqual([])
	})
})

describe('blacklist settings', () => {
	test('splits p tags and product/collection a tags', () => {
		const product = `30402:${ALICE}:p1`
		const collection = `30405:${BOB}:c1`
		const ev = event(
			[
				['p', ALICE],
				['a', product],
				['a', `30408:${BOB}:x`],
				['a', collection],
				['a', ''],
				['p', BOB],
			],
			42,
		)
		expect(parseBlacklistSettings(ev)).toEqual({
			blacklistedPubkeys: [ALICE, BOB],
			blacklistedProducts: [product],
			blacklistedCollections: [collection],
			lastUpdated: 42,
			event: ev,
		})
	})

	test('missing event yields an empty blacklist', () => {
		expect(parseBlacklistSettings(null)).toEqual({
			blacklistedPubkeys: [],
			blacklistedProducts: [],
			blacklistedCollections: [],
			lastUpdated: 0,
			event: null,
		})
	})

	test('helpers', () => {
		const settings = parseBlacklistSettings(event([['p', ALICE]]))
		expect(isBlacklisted(settings, ALICE)).toBe(true)
		expect(isBlacklisted(settings, BOB)).toBe(false)
		expect(isBlacklisted(null, ALICE)).toBe(false)
		expect(getFormattedBlacklist(settings)).toEqual([{ pubkey: ALICE, status: 'blacklisted' }])
		expect(getFormattedBlacklist(undefined)).toEqual([])
	})
})

describe('featured lists', () => {
	test('products keep only 30402 coordinates in order and apply the host filter', () => {
		const p1 = `30402:${ALICE}:one`
		const p2 = `30402:${BOB}:two`
		const ev = event(
			[
				['d', 'featured_products'],
				['a', p2],
				['a', `30405:${ALICE}:c`],
				['a', p1],
			],
			9,
		)
		expect(parseFeaturedProducts(ev, keep)).toEqual({ featuredProducts: [p2, p1], lastUpdated: 9 })
		expect(parseFeaturedProducts(ev, (items) => items.filter((c) => c !== p2)).featuredProducts).toEqual([p1])
	})

	test('missing created_at falls back to the supplied clock', () => {
		expect(parseFeaturedProducts(event([]), keep, 1234).lastUpdated).toBe(1234)
	})

	test('collections keep only 30405 coordinates', () => {
		const c1 = `30405:${ALICE}:c`
		expect(
			parseFeaturedCollections(
				event(
					[
						['a', c1],
						['a', `30402:${ALICE}:p`],
					],
					3,
				),
				keep,
			),
		).toEqual({
			featuredCollections: [c1],
			lastUpdated: 3,
		})
	})

	test('auctions drop malformed coordinates and filtered sellers', () => {
		const ok = `30408:${ALICE}:auction`
		const banned = `30408:${BOB}:auction`
		const ev = event(
			[
				['a', ok],
				['a', `30408:${ALICE}:`],
				['a', `30408::x`],
				['a', `30408:${ALICE}:x:y`],
				['a', banned],
			],
			7,
		)
		expect(parseFeaturedAuctions(ev, (pubkeys) => pubkeys.filter((p) => p !== BOB))).toEqual({ featuredAuctions: [ok], lastUpdated: 7 })
	})

	test('users come from p tags', () => {
		expect(
			parseFeaturedUsers(
				event(
					[
						['p', BOB],
						['p', ALICE],
						['a', 'x'],
					],
					1,
				),
				keep,
			),
		).toEqual({ featuredUsers: [BOB, ALICE], lastUpdated: 1 })
	})
})

describe('vanity registry', () => {
	const NOW = 1_000

	test('filter targets the vanity-urls list with optional limit', () => {
		expect(buildVanityRegistryFilter(APP)).toEqual({ kinds: [30000], authors: [APP], '#d': ['vanity-urls'] })
		expect(buildVanityRegistryFilter(APP, 1)).toEqual({ kinds: [30000], authors: [APP], '#d': ['vanity-urls'], limit: 1 })
	})

	test('no events yields an empty registry', () => {
		expect(parseVanitySettings([])).toEqual({ entries: [], lastUpdated: 0, event: null })
	})

	test('parses the newest event, lowercasing names and skipping incomplete tags', () => {
		const older = event([['vanity', 'old', ALICE, '5']], 1)
		const newer = event(
			[
				['vanity', 'Alice', ALICE, '2000'],
				['vanity', 'bob', BOB, 'nope'],
				['vanity', 'carol', CAROL],
			],
			2,
		)
		expect(parseVanitySettings([older, newer])).toEqual({
			entries: [
				{ vanityName: 'alice', pubkey: ALICE, validUntil: 2000 },
				{ vanityName: 'bob', pubkey: BOB, validUntil: 0 },
			],
			lastUpdated: 2,
			event: newer,
		})
	})

	test('lookup helpers respect expiry', () => {
		const settings = parseVanitySettings([
			event([
				['vanity', 'alice', ALICE, '2000'],
				['vanity', 'old', ALICE, '500'],
				['vanity', 'edge', BOB, String(NOW)],
			]),
		])
		expect(isVanityAvailable(settings, '', NOW)).toBe(false)
		expect(isVanityAvailable(null, 'any', NOW)).toBe(true)
		expect(isVanityAvailable(settings, 'ALICE', NOW)).toBe(false)
		expect(isVanityAvailable(settings, 'old', NOW)).toBe(true)
		expect(isVanityAvailable(settings, 'edge', NOW)).toBe(false)
		expect(isVanityAvailable(settings, 'free', NOW)).toBe(true)

		expect(resolveVanity(settings, 'Alice', NOW)?.pubkey).toBe(ALICE)
		expect(resolveVanity(settings, 'old', NOW)).toBeNull()
		expect(resolveVanity(settings, 'edge', NOW)?.pubkey).toBe(BOB)
		expect(resolveVanity(undefined, 'alice', NOW)).toBeNull()

		expect(getVanityForPubkey(settings, ALICE, NOW)?.vanityName).toBe('alice')
		expect(getVanityForPubkey(settings, BOB, NOW)).toBeNull()
		expect(getVanityForPubkey(settings, '', NOW)).toBeNull()

		expect(getExpiredVanityForPubkey(settings, ALICE, NOW).map((e) => e.vanityName)).toEqual(['old'])
		expect(getExpiredVanityForPubkey(settings, BOB, NOW).map((e) => e.vanityName)).toEqual(['edge'])
		expect(getExpiredVanityForPubkey(null, ALICE, NOW)).toEqual([])
	})
})
