import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import {
	buildV4VMerchantsFilter,
	buildV4VSharesFilter,
	collectV4VMerchantPubkeys,
	normalizeAndEncodePubkey,
	parseV4VShareEntries,
	pickMostRecentV4VEvent,
	resolveParsedV4VState,
	resolveV4VConfigurationState,
} from './v4vRead'

const HEX_A = 'a'.repeat(64)
const HEX_B = 'b'.repeat(64)

function silenceConsole<T>(fn: () => T): T {
	const { error, warn } = console
	console.error = () => {}
	console.warn = () => {}
	try {
		return fn()
	} finally {
		console.error = error
		console.warn = warn
	}
}

describe('v4v filters', () => {
	test('builds the per-user share filter', () => {
		expect(buildV4VSharesFilter('pk')).toEqual({ kinds: [30078], authors: ['pk'], '#l': ['v4v_share'] })
	})

	test('builds the merchants filter', () => {
		expect(buildV4VMerchantsFilter()).toEqual({ kinds: [30078], '#l': ['v4v_share'], limit: 100 })
	})
})

describe('normalizeAndEncodePubkey', () => {
	test('left-pads odd-length hex', () => {
		const result = normalizeAndEncodePubkey('a'.repeat(63))
		expect(result?.pubkey).toBe('0' + 'a'.repeat(63))
	})

	test('decodes npub and strips a stray leading 0', () => {
		const npub = nip19.npubEncode(HEX_A)
		expect(normalizeAndEncodePubkey(npub)).toEqual({ pubkey: HEX_A, npub })
		expect(normalizeAndEncodePubkey('0' + npub)).toEqual({ pubkey: HEX_A, npub })
	})

	test('rejects unknown formats', () => {
		expect(silenceConsole(() => normalizeAndEncodePubkey('not-a-key'))).toBeNull()
	})
})

describe('resolveV4VConfigurationState', () => {
	test('distinguishes never-configured, zero, nonzero and unknown', () => {
		expect(resolveV4VConfigurationState(null)).toBe('never-configured')
		expect(resolveV4VConfigurationState({ content: '[]' })).toBe('configured-zero')
		expect(resolveV4VConfigurationState({ content: '[["zap","x","0.1"]]' })).toBe('configured-nonzero')
		expect(silenceConsole(() => resolveV4VConfigurationState({ content: '{}' }))).toBe('unknown')
		expect(silenceConsole(() => resolveV4VConfigurationState({ content: 'nope' }))).toBe('unknown')
	})

	test('parsed shares resolve to nonzero, none to unknown', () => {
		expect(resolveParsedV4VState(2)).toBe('configured-nonzero')
		expect(resolveParsedV4VState(0)).toBe('unknown')
	})
})

describe('parseV4VShareEntries', () => {
	test('dedupes by normalized pubkey, indexes over the deduped list and defaults bad percentages to 5', () => {
		const content = JSON.stringify([
			['zap', HEX_A, '0.1'],
			['zap', nip19.npubEncode(HEX_A), '0.9'],
			['p', HEX_B, '0.2'],
			['zap', HEX_B],
			['zap', 'b'.repeat(63) + 'c', 'abc'],
		])
		const entries = silenceConsole(() => parseV4VShareEntries(content))
		expect(entries).toEqual([
			{ id: `v4v-0-${HEX_A.slice(0, 8)}`, pubkey: HEX_A, percentage: 0.1 },
			{ id: `v4v-2-bbbbbbbb`, pubkey: 'b'.repeat(63) + 'c', percentage: 5 },
		])
	})

	test('a recipient without a percentage still claims its pubkey', () => {
		const content = JSON.stringify([
			['zap', HEX_A],
			['zap', HEX_A, '0.3'],
		])
		expect(parseV4VShareEntries(content)).toEqual([])
	})

	test('non-array and empty content yield no entries; invalid JSON throws', () => {
		expect(parseV4VShareEntries('{}')).toEqual([])
		expect(parseV4VShareEntries('[]')).toEqual([])
		expect(() => parseV4VShareEntries('nope')).toThrow()
	})
})

describe('event selection', () => {
	test('picks the most recent timestamped event, or null', () => {
		const older = { created_at: 1, id: 'a' }
		const newer = { created_at: 2, id: 'b' }
		expect(pickMostRecentV4VEvent([older, newer])).toBe(newer)
		expect(pickMostRecentV4VEvent([{ id: 'x' } as { created_at?: number }])).toBeNull()
	})

	test('collects unique merchant pubkeys in first-seen order', () => {
		expect(collectV4VMerchantPubkeys([{ pubkey: 'b' }, { pubkey: 'a' }, { pubkey: 'b' }, { pubkey: '' }])).toEqual(['b', 'a'])
	})
})
