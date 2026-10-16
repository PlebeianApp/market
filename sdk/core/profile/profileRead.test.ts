import { describe, expect, test } from 'bun:test'
import {
	buildNip05RegistryFilter,
	getExpiredNip05ForPubkey,
	getNip05ForPubkey,
	isNip05Available,
	parseNip05Settings,
	readNip05Entries,
} from './nip05'
import {
	buildProfileMetadataFilter,
	emptyZapCapabilityInfo,
	getNormalizedProfileDisplayName,
	getNormalizedProfileNip05,
	getNormalizedProfilePicture,
	isNpubIdentifier,
	normalizeOptionalPubkey,
	normalizeOptionalString,
	parseNostrAuthor,
	pickLatestEvent,
	summarizeZapMethods,
} from './profileRead'

const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)
const APP = 'a'.repeat(64)

describe('profile filters', () => {
	test('metadata filter targets kind 0 for one author', () => {
		expect(buildProfileMetadataFilter(ALICE)).toEqual({ kinds: [0], authors: [ALICE] })
	})
})

describe('profile normalisation', () => {
	test('normalizeOptionalString trims and rejects blanks and non-strings', () => {
		expect(normalizeOptionalString('  hi ')).toBe('hi')
		expect(normalizeOptionalString('   ')).toBeNull()
		expect(normalizeOptionalString(42)).toBeNull()
		expect(normalizeOptionalString(undefined)).toBeNull()
	})

	test('normalizeOptionalPubkey trims and maps blanks to undefined', () => {
		expect(normalizeOptionalPubkey(` ${ALICE} `)).toBe(ALICE)
		expect(normalizeOptionalPubkey('  ')).toBeUndefined()
		expect(normalizeOptionalPubkey(undefined)).toBeUndefined()
	})

	test('display name prefers displayName, then name', () => {
		expect(getNormalizedProfileDisplayName({ displayName: ' Al ', name: 'alice' })).toBe('Al')
		expect(getNormalizedProfileDisplayName({ displayName: '  ', name: 'alice' })).toBe('alice')
		expect(getNormalizedProfileDisplayName({})).toBeNull()
		expect(getNormalizedProfileDisplayName(null)).toBeNull()
	})

	test('nip05 and picture normalise with their own fallbacks', () => {
		expect(getNormalizedProfileNip05({ nip05: ' a@b.c ' })).toBe('a@b.c')
		expect(getNormalizedProfileNip05(undefined)).toBeNull()
		expect(getNormalizedProfilePicture({ picture: ' https://x/y.png ' })).toBe('https://x/y.png')
		expect(getNormalizedProfilePicture({ picture: '' })).toBe('')
		expect(getNormalizedProfilePicture(null)).toBe('')
	})
})

describe('authors', () => {
	test('pickLatestEvent returns the newest, missing created_at counts as 0, ties keep input order', () => {
		const a = { id: 'a', created_at: 5 }
		const b = { id: 'b', created_at: 10 }
		const c = { id: 'c', created_at: 10 }
		const d: { id: string; created_at?: number } = { id: 'd' }
		expect(pickLatestEvent([a, b, c, d])).toBe(b)
		expect(pickLatestEvent([d])).toBe(d)
		expect(pickLatestEvent([])).toBeUndefined()
	})

	test('pickLatestEvent does not mutate the input', () => {
		const events = [{ created_at: 1 }, { created_at: 2 }]
		pickLatestEvent(events)
		expect(events.map((e) => e.created_at)).toEqual([1, 2])
	})

	test('parseNostrAuthor reads content fields and prefers a name tag', () => {
		const content = JSON.stringify({ name: 'alice', about: 'hi', picture: 'p', nip05: 'a@b.c' })
		expect(parseNostrAuthor({ pubkey: ALICE, content, tags: [] })).toEqual({
			id: ALICE,
			name: 'alice',
			about: 'hi',
			picture: 'p',
			nip05: 'a@b.c',
		})
		expect(parseNostrAuthor({ pubkey: ALICE, content, tags: [['name', 'Tagged']] }).name).toBe('Tagged')
		expect(parseNostrAuthor({ pubkey: ALICE, content, tags: [['name', '']] }).name).toBe('alice')
	})

	test('parseNostrAuthor tolerates null JSON and throws on invalid JSON', () => {
		expect(parseNostrAuthor({ pubkey: ALICE, content: 'null', tags: [] })).toEqual({
			id: ALICE,
			name: undefined,
			about: undefined,
			picture: undefined,
			nip05: undefined,
		})
		expect(() => parseNostrAuthor({ pubkey: ALICE, content: '{not json', tags: [['name', 'x']] })).toThrow()
	})
})

describe('zap capability', () => {
	test('isNpubIdentifier requires an npub prefix', () => {
		expect(isNpubIdentifier('npub1abc')).toBe(true)
		expect(isNpubIdentifier('')).toBe(false)
		expect(isNpubIdentifier(ALICE)).toBe(false)
	})

	test('summarizeZapMethods keeps order and flags each method', () => {
		expect(summarizeZapMethods(['nip61', 'nip57'])).toEqual({
			canReceiveZaps: true,
			methods: ['nip61', 'nip57'],
			hasLightning: true,
			hasCashu: true,
		})
		expect(summarizeZapMethods(new Map([['nip57', {}]]).keys())).toEqual({
			canReceiveZaps: true,
			methods: ['nip57'],
			hasLightning: true,
			hasCashu: false,
		})
		expect(summarizeZapMethods([])).toEqual(emptyZapCapabilityInfo())
	})

	test('emptyZapCapabilityInfo returns a fresh object each call', () => {
		expect(emptyZapCapabilityInfo()).not.toBe(emptyZapCapabilityInfo())
	})
})

describe('nip05 registry', () => {
	const NOW = 1_000

	test('filter targets the nip05-names list, limit only when given', () => {
		expect(buildNip05RegistryFilter(APP)).toEqual({ kinds: [30000], authors: [APP], '#d': ['nip05-names'] })
		expect(buildNip05RegistryFilter(APP, 1)).toEqual({ kinds: [30000], authors: [APP], '#d': ['nip05-names'], limit: 1 })
	})

	test('entries require all fields; usernames are lowercased; bad expiry is 0', () => {
		expect(
			readNip05Entries([
				['nip05', 'Alice', ALICE, '2000'],
				['nip05', 'bob', BOB, 'x'],
				['nip05', 'carol', BOB],
				['vanity', 'dave', BOB, '2000'],
			]),
		).toEqual([
			{ username: 'alice', pubkey: ALICE, validUntil: 2000 },
			{ username: 'bob', pubkey: BOB, validUntil: 0 },
		])
	})

	test('settings come from the newest event; none yields an empty registry', () => {
		expect(parseNip05Settings([])).toEqual({ entries: [], lastUpdated: 0, event: null })
		const older = { tags: [['nip05', 'old', ALICE, '1']], created_at: 1 }
		const newer = { tags: [['nip05', 'new', BOB, '2']], created_at: 2 }
		const settings = parseNip05Settings([older, newer])
		expect(settings.event).toBe(newer)
		expect(settings.lastUpdated).toBe(2)
		expect(settings.entries).toEqual([{ username: 'new', pubkey: BOB, validUntil: 2 }])
	})

	test('availability is case-insensitive and frees expired names', () => {
		const settings = parseNip05Settings([
			{
				tags: [
					['nip05', 'alice', ALICE, String(NOW + 1)],
					['nip05', 'bob', BOB, String(NOW - 1)],
				],
				created_at: 1,
			},
		])
		expect(isNip05Available(settings, '', NOW)).toBe(false)
		expect(isNip05Available(null, 'x', NOW)).toBe(true)
		expect(isNip05Available(settings, 'ALICE', NOW)).toBe(false)
		expect(isNip05Available(settings, 'bob', NOW)).toBe(true)
		expect(isNip05Available(settings, 'carol', NOW)).toBe(true)
	})

	test('active and expired lookups split on validUntil', () => {
		const settings = parseNip05Settings([
			{
				tags: [
					['nip05', 'a1', ALICE, String(NOW)],
					['nip05', 'a2', ALICE, String(NOW + 5)],
				],
				created_at: 1,
			},
		])
		expect(getNip05ForPubkey(settings, ALICE, NOW)?.username).toBe('a2')
		expect(getNip05ForPubkey(settings, BOB, NOW)).toBeNull()
		expect(getNip05ForPubkey(settings, '', NOW)).toBeNull()
		expect(getExpiredNip05ForPubkey(settings, ALICE, NOW).map((e) => e.username)).toEqual(['a1'])
		expect(getExpiredNip05ForPubkey(null, ALICE, NOW)).toEqual([])
	})
})
