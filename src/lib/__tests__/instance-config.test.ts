import { describe, expect, test } from 'bun:test'
import { DEFAULT_INSTANCE_CONFIG, parseInstanceConfigEnvironment, resolveInstanceConfig } from '@/lib/instance-config'
import { AppSettingsSchema } from '@/lib/schemas/app'
import { configActions, configStore } from '@/lib/stores/config'
import { createHandlerInfoEventData, createClientTag } from '@/publish/nip89'

const existingSettings = {
	name: 'Existing Market',
	displayName: 'Existing Market',
	picture: 'https://example.com/logo.png',
	banner: 'https://example.com/banner.png',
	ownerPk: 'a'.repeat(64),
	allowRegister: true,
	defaultCurrency: 'USD',
}

describe('AppSettingsSchema instance fields', () => {
	test('keeps existing settings events valid', () => {
		expect(AppSettingsSchema.parse(existingSettings)).toMatchObject(existingSettings)
	})

	test('accepts supported service URL protocols', () => {
		const result = AppSettingsSchema.parse({
			...existingSettings,
			siteUrl: 'https://market.example.com',
			publicRelays: ['wss://relay.example.com', 'ws://localhost:10547'],
			trustedMints: ['https://mint.example.com'],
			bugRelay: 'wss://bugs.example.com',
			termsUrl: 'https://market.example.com/terms',
		})

		expect(result.publicRelays).toHaveLength(2)
	})

	test('rejects protocols that do not match the service type', () => {
		expect(() => AppSettingsSchema.parse({ ...existingSettings, publicRelays: ['https://relay.example.com'] })).toThrow()
		expect(() => AppSettingsSchema.parse({ ...existingSettings, termsUrl: 'ftp://market.example.com/terms' })).toThrow()
	})
})

describe('resolveInstanceConfig', () => {
	test('uses event values before environment and defaults', () => {
		const appSettings = AppSettingsSchema.parse({
			...existingSettings,
			siteUrl: 'https://event.example.com',
			publicRelays: ['wss://event-relay.example.com'],
		})

		const result = resolveInstanceConfig(appSettings, {
			name: 'Environment Market',
			siteUrl: 'https://environment.example.com',
			publicRelays: ['wss://environment-relay.example.com'],
			termsUrl: 'https://environment.example.com/terms',
		})

		expect(result.name).toBe('Existing Market')
		expect(result.siteUrl).toBe('https://event.example.com')
		expect(result.publicRelays).toEqual(['wss://event-relay.example.com'])
		expect(result.termsUrl).toBe('https://environment.example.com/terms')
		expect(result.handlerId).toBe(DEFAULT_INSTANCE_CONFIG.handlerId)
	})

	test('uses environment values before defaults when settings are absent', () => {
		const result = resolveInstanceConfig(null, {
			name: 'Environment Market',
			siteUrl: 'https://environment.example.com',
		})

		expect(result.name).toBe('Environment Market')
		expect(result.siteUrl).toBe('https://environment.example.com')
		expect(result.displayName).toBe(DEFAULT_INSTANCE_CONFIG.displayName)
	})

	test('replaces arrays and social links instead of merging them', () => {
		const appSettings = AppSettingsSchema.parse({
			...existingSettings,
			publicRelays: ['wss://event-relay.example.com'],
			socialLinks: { github: 'https://github.com/example/market' },
		})

		const result = resolveInstanceConfig(appSettings, {
			publicRelays: ['wss://environment-relay.example.com'],
			socialLinks: { twitter: 'https://twitter.com/example' },
		})

		expect(result.publicRelays).toEqual(['wss://event-relay.example.com'])
		expect(result.socialLinks).toEqual({ github: 'https://github.com/example/market' })
	})

	test('falls back to defaults when an old-format settings event and an empty environment both omit a field', () => {
		// Regression test: parseInstanceConfigEnvironment always emits every key
		// (undefined when the env var is unset), and an app-settings event
		// published before this field existed also omits it. Neither source
		// should be able to clobber DEFAULT_INSTANCE_CONFIG with `undefined`.
		const appSettings = AppSettingsSchema.parse(existingSettings)
		const result = resolveInstanceConfig(appSettings, parseInstanceConfigEnvironment({}))

		expect(result.publicRelays).toEqual(DEFAULT_INSTANCE_CONFIG.publicRelays)
		expect(result.trustedMints).toEqual(DEFAULT_INSTANCE_CONFIG.trustedMints)
		expect(result.socialLinks).toEqual(DEFAULT_INSTANCE_CONFIG.socialLinks)
		expect(result.bugRelay).toBe(DEFAULT_INSTANCE_CONFIG.bugRelay)
	})

	test('returns copies of mutable defaults', () => {
		const first = resolveInstanceConfig(null)
		first.publicRelays.push('wss://mutated.example.com')
		first.socialLinks.github = 'https://github.com/mutated/market'

		const second = resolveInstanceConfig(null)
		expect(second.publicRelays).toEqual(DEFAULT_INSTANCE_CONFIG.publicRelays)
		expect(second.socialLinks).toEqual(DEFAULT_INSTANCE_CONFIG.socialLinks)
	})
})

describe('parseInstanceConfigEnvironment', () => {
	test('parses optional booleans, lists, and social links', () => {
		const result = parseInstanceConfigEnvironment({
			INSTANCE_ALLOW_REGISTER: 'false',
			INSTANCE_PUBLIC_RELAYS: 'wss://one.example.com, ws://localhost:10547',
			INSTANCE_TRUSTED_MINTS: 'https://mint.example.com',
			INSTANCE_GITHUB_URL: 'https://github.com/example/market',
		})

		expect(result.allowRegister).toBe(false)
		expect(result.publicRelays).toEqual(['wss://one.example.com', 'ws://localhost:10547'])
		expect(result.trustedMints).toEqual(['https://mint.example.com'])
		expect(result.socialLinks).toEqual({ github: 'https://github.com/example/market' })
	})

	test('rejects malformed environment values', () => {
		expect(() => parseInstanceConfigEnvironment({ INSTANCE_ALLOW_REGISTER: 'yes' })).toThrow()
		expect(() => parseInstanceConfigEnvironment({ INSTANCE_PUBLIC_RELAYS: 'https://relay.example.com' })).toThrow()
		expect(() => parseInstanceConfigEnvironment({ INSTANCE_SITE_URL: 'ftp://market.example.com' })).toThrow()
	})
})

describe('runtime-config-aware handler metadata', () => {
	test('uses config overrides for host, relay, and handler ID when present', () => {
		configActions.setConfig({
			appRelay: 'wss://selfhost.example',
			siteUrl: 'https://selfhost.example',
			handlerId: 'custom-handler',
			appSettings: null,
			appPublicKey: 'a'.repeat(64),
			stage: 'production',
			needsSetup: false,
			serverReady: true,
			name: 'Self Host',
			displayName: 'Self Host',
			picture: 'https://selfhost.example/logo.png',
			banner: 'https://selfhost.example/banner.png',
			allowRegister: true,
			defaultCurrency: 'USD',
			showNostrLink: false,
			publicRelays: ['wss://selfhost.example'],
			trustedMints: ['https://mint.selfhost.example'],
			bugRelay: 'wss://bugs.selfhost.example',
			socialLinks: { github: 'https://github.com/selfhost' },
		} as any)

		const event = createHandlerInfoEventData('b'.repeat(64), { ok: true })
		expect(event.tags).toContainEqual(['d', 'custom-handler'])
		expect(event.tags).toContainEqual(['web', 'https://selfhost.example/product/<bech32>', 'naddr'])
		expect(event.tags).toContainEqual(['web', 'https://selfhost.example/collection/<bech32>', 'naddr'])
		const appPubkey = 'b'.repeat(64)
		expect(createClientTag(appPubkey, 'custom-handler')).toEqual([
			'client',
			'Self Host',
			`31990:${appPubkey}:custom-handler`,
			'wss://selfhost.example',
		])
	})

	test('falls back to the shipped Plebeian defaults when config is absent', () => {
		configStore.setState((state) => ({ ...state, config: {} }))

		const event = createHandlerInfoEventData('c'.repeat(64), { ok: true })
		expect(event.tags).toContainEqual(['d', DEFAULT_INSTANCE_CONFIG.handlerId])
		expect(event.tags).toContainEqual(['web', `${DEFAULT_INSTANCE_CONFIG.siteUrl}/product/<bech32>`, 'naddr'])
	})

	test('uses explicit handler metadata from the instance configuration form', () => {
		const event = createHandlerInfoEventData(
			'd'.repeat(64),
			{ ok: true },
			'wss://relay.selfhost.example',
			'selfhost-handler',
			'https://selfhost.example',
		)

		expect(event.tags).toContainEqual(['d', 'selfhost-handler'])
		expect(event.tags).toContainEqual(['r', 'wss://relay.selfhost.example'])
		expect(event.tags).toContainEqual(['web', 'https://selfhost.example/product/<bech32>', 'naddr'])
	})
})
