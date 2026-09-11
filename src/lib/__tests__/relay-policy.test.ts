import { describe, expect, test } from 'bun:test'
import { computeNdkConfig, resolveExplicitRelays, resolveMainRelay, resolveZapRelays } from '@/lib/relay-policy'
import { DEFAULT_PUBLIC_RELAYS, ZAP_RELAYS } from '@/lib/constants'

describe('resolveMainRelay', () => {
	test('uses appRelay when provided', () => {
		const result = resolveMainRelay('production', 'wss://custom.example.com')
		expect(result).toBe('wss://custom.example.com')
	})

	test('falls back to stage-based main relay when appRelay is absent', () => {
		expect(resolveMainRelay('production')).toBe('wss://relay.plebeian.market')
		expect(resolveMainRelay('staging')).toBe('wss://relay.staging.plebeian.market')
		expect(resolveMainRelay('development')).toBe('ws://localhost:10547')
	})

	test('returns undefined when stage is undefined', () => {
		const result = resolveMainRelay(undefined)
		expect(result).toBeUndefined()
	})
})

describe('resolveExplicitRelays', () => {
	test('self-hosted: uses provided publicRelays for production', () => {
		const result = resolveExplicitRelays({
			stage: 'production',
			mainRelay: 'wss://selfhost.example',
			publicRelays: ['wss://relay1.selfhost.example', 'wss://relay2.selfhost.example'],
		})
		expect(result).toContain('wss://selfhost.example')
		expect(result).toContain('wss://relay1.selfhost.example')
		expect(result).toContain('wss://relay2.selfhost.example')
	})

	test('falls back to DEFAULT_PUBLIC_RELAYS when publicRelays not provided', () => {
		const result = resolveExplicitRelays({
			stage: 'production',
			mainRelay: 'wss://relay.plebeian.market',
		})
		expect(result).toContain('wss://relay.plebeian.market')
		DEFAULT_PUBLIC_RELAYS.forEach((relay) => {
			expect(result).toContain(relay)
		})
	})

	test('dev/staging uses main relay only regardless of publicRelays', () => {
		const result = resolveExplicitRelays({
			stage: 'development',
			mainRelay: 'ws://localhost:10547',
			publicRelays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
		})
		expect(result).toEqual(['ws://localhost:10547'])
	})

	test('localRelayOnly uses main relay only', () => {
		const result = resolveExplicitRelays({
			stage: 'production',
			mainRelay: 'ws://localhost:10547',
			publicRelays: ['wss://relay1.example.com'],
			localRelayOnly: true,
		})
		expect(result).toEqual(['ws://localhost:10547'])
	})
})

describe('resolveZapRelays', () => {
	test('self-hosted: uses provided zapRelays plus explicit relays', () => {
		const selfHostedZapRelays = ['wss://zap1.selfhost.example', 'wss://zap2.selfhost.example']
		const result = resolveZapRelays(['wss://main.example.com', 'wss://public.example.com'], selfHostedZapRelays)
		expect(result).toContain('wss://zap1.selfhost.example')
		expect(result).toContain('wss://zap2.selfhost.example')
		expect(result).toContain('wss://main.example.com')
		expect(result).toContain('wss://public.example.com')
	})

	test('falls back to ZAP_RELAYS when zapRelays not provided', () => {
		const result = resolveZapRelays(['wss://main.relay.com'])
		expect(result).toContain('wss://main.relay.com')
		ZAP_RELAYS.forEach((relay) => {
			expect(result).toContain(relay)
		})
	})

	test('deduplicates relays', () => {
		const result = resolveZapRelays(['wss://relay.damus.io', 'wss://relay.damus.io'])
		const damusCount = result.filter((r) => r === 'wss://relay.damus.io').length
		expect(damusCount).toBe(1)
	})
})

describe('computeNdkConfig', () => {
	test('self-hosted production: includes main + custom publicRelays', () => {
		const config = computeNdkConfig({
			stage: 'production',
			appRelay: 'wss://selfhost.example',
			publicRelays: ['wss://relay1.selfhost.example', 'wss://relay2.selfhost.example'],
			zapRelays: ['wss://zap.selfhost.example'],
		})

		expect(config.explicitRelayUrls).toContain('wss://selfhost.example')
		expect(config.explicitRelayUrls).toContain('wss://relay1.selfhost.example')
		expect(config.explicitRelayUrls).toContain('wss://relay2.selfhost.example')
		expect(config.writeRelayUrls).toEqual(config.explicitRelayUrls) // prod: all relays
		expect(config.enableOutbox).toBe(true)
	})

	test('plebeian production: includes main + DEFAULT_PUBLIC_RELAYS', () => {
		const config = computeNdkConfig({
			stage: 'production',
			appRelay: 'wss://relay.plebeian.market',
		})

		expect(config.explicitRelayUrls).toContain('wss://relay.plebeian.market')
		DEFAULT_PUBLIC_RELAYS.forEach((relay) => {
			expect(config.explicitRelayUrls).toContain(relay)
		})
	})

	test('staging restricts writes to main relay only', () => {
		const config = computeNdkConfig({
			stage: 'staging',
			appRelay: 'wss://relay.staging.plebeian.market',
			publicRelays: ['wss://public1.example.com', 'wss://public2.example.com'],
		})

		expect(config.writeRelayUrls).toEqual(['wss://relay.staging.plebeian.market'])
		expect(config.enableOutbox).toBe(false)
	})

	test('development restricts writes to main relay only', () => {
		const config = computeNdkConfig({
			stage: 'development',
			appRelay: 'ws://localhost:10547',
		})

		expect(config.writeRelayUrls).toEqual(['ws://localhost:10547'])
		expect(config.enableOutbox).toBe(false)
	})
})
