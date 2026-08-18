import {
	APP_SETTINGS_D_TAG,
	APP_SETTINGS_KIND,
	fetchAppSettings,
	resolveFetchedAppSettings,
	selectAuthoritativeAppSettingsEvent,
	type AppSettingsEventLike,
} from '../appSettings'
import { describe, expect, test } from 'bun:test'

const APP_PUBKEY = 'a'.repeat(64)
const SPOOF_PUBKEY = 'b'.repeat(64)

const VALID_SETTINGS = {
	name: 'Demo Market',
	displayName: 'Demo Market',
	picture: 'https://example.com/picture.png',
	banner: 'https://example.com/banner.png',
	ownerPk: 'c'.repeat(64),
	allowRegister: false,
	defaultCurrency: 'sat',
	showNostrLink: false,
}

/** Minimal event factory satisfying the AppSettingsEventLike structural type. */
function mockEvent(opts: Partial<AppSettingsEventLike> & { pubkey?: string }): AppSettingsEventLike {
	return {
		kind: opts.kind ?? APP_SETTINGS_KIND,
		pubkey: opts.pubkey ?? APP_PUBKEY,
		tags: opts.tags ?? [['d', APP_SETTINGS_D_TAG]],
		created_at: opts.created_at ?? 100,
		content: opts.content ?? '{}',
	}
}

describe('selectAuthoritativeAppSettingsEvent', () => {
	test('returns the latest event matching the expected author, kind, and d tag', () => {
		const events = [mockEvent({ created_at: 50 }), mockEvent({ created_at: 100 })]

		const result = selectAuthoritativeAppSettingsEvent(events, APP_PUBKEY)

		expect(result).toBeDefined()
		expect(result?.pubkey).toBe(APP_PUBKEY)
		expect(result?.kind).toBe(APP_SETTINGS_KIND)
		expect(result?.created_at).toBe(100)
	})

	test('rejects an event from a different publisher (spoofed author)', () => {
		const events = [mockEvent({ pubkey: SPOOF_PUBKEY, created_at: 999, content: '{"name":"evil"}' })]

		const result = selectAuthoritativeAppSettingsEvent(events, APP_PUBKEY)

		expect(result).toBeUndefined()
	})

	test('rejects an event with the wrong kind', () => {
		const events = [mockEvent({ kind: 30000 })]

		const result = selectAuthoritativeAppSettingsEvent(events, APP_PUBKEY)

		expect(result).toBeUndefined()
	})

	test('rejects an event with a different d tag', () => {
		const events = [mockEvent({ tags: [['d', 'some-other-handler']] })]

		const result = selectAuthoritativeAppSettingsEvent(events, APP_PUBKEY)

		expect(result).toBeUndefined()
	})

	test('rejects an event with no d tag at all', () => {
		const events = [mockEvent({ tags: [] })]

		const result = selectAuthoritativeAppSettingsEvent(events, APP_PUBKEY)

		expect(result).toBeUndefined()
	})

	test('returns undefined for an empty event list', () => {
		const result = selectAuthoritativeAppSettingsEvent([], APP_PUBKEY)

		expect(result).toBeUndefined()
	})

	test('ignores a higher-timestamp spoofed event and selects the legitimate one', () => {
		const events = [
			mockEvent({ pubkey: SPOOF_PUBKEY, created_at: 999, content: '{"name":"evil"}' }),
			mockEvent({ created_at: 50, content: '{"name":"real"}' }),
		]

		const result = selectAuthoritativeAppSettingsEvent(events, APP_PUBKEY)

		expect(result).toBeDefined()
		expect(result?.pubkey).toBe(APP_PUBKEY)
		expect(result?.created_at).toBe(50)
		expect(result?.content).toBe('{"name":"real"}')
	})

	test('selects the newest among multiple valid events from the same publisher', () => {
		const events = [mockEvent({ created_at: 10 }), mockEvent({ created_at: 200 }), mockEvent({ created_at: 100 })]

		const result = selectAuthoritativeAppSettingsEvent(events, APP_PUBKEY)

		expect(result?.created_at).toBe(200)
	})
})

describe('resolveFetchedAppSettings', () => {
	test('returns null only when a completed query returned no candidate events', () => {
		expect(resolveFetchedAppSettings([], APP_PUBKEY)).toBeNull()
	})

	test('returns validated settings from the authoritative event', () => {
		const event = mockEvent({ content: JSON.stringify(VALID_SETTINGS) })

		expect(resolveFetchedAppSettings([event], APP_PUBKEY)).toEqual(VALID_SETTINGS)
	})

	test('fails closed when returned candidates contain no authoritative event', () => {
		const spoofed = mockEvent({
			pubkey: SPOOF_PUBKEY,
			content: JSON.stringify(VALID_SETTINGS),
		})

		expect(() => resolveFetchedAppSettings([spoofed], APP_PUBKEY)).toThrow(/No authoritative app settings event/)
	})

	test('fails closed on malformed authoritative JSON', () => {
		const event = mockEvent({ content: '{not-json' })

		expect(() => resolveFetchedAppSettings([event], APP_PUBKEY)).toThrow(/invalid JSON/)
	})

	test('fails closed when authoritative settings fail schema validation', () => {
		const event = mockEvent({ content: JSON.stringify({ name: 'incomplete' }) })

		expect(() => resolveFetchedAppSettings([event], APP_PUBKEY)).toThrow(/schema validation/)
	})
})

describe('fetchAppSettings fail-closed preflight', () => {
	test('rejects malformed app pubkeys before relay I/O', async () => {
		await expect(fetchAppSettings('wss://relay.invalid', 'not-a-pubkey')).rejects.toThrow(/Invalid app pubkey/)
	})
})
