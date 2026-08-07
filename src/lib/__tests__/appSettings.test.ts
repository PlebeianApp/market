import { selectAuthoritativeAppSettingsEvent, APP_SETTINGS_KIND, APP_SETTINGS_D_TAG, type AppSettingsEventLike } from '../appSettings'
import { describe, expect, test } from 'bun:test'

const APP_PUBKEY = 'a'.repeat(64)
const SPOOF_PUBKEY = 'b'.repeat(64)

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
