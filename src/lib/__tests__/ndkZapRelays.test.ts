import { describe, expect, test } from 'bun:test'
import { DEFAULT_PUBLIC_RELAYS, ZAP_RELAYS } from '@/lib/constants'
import { computeNdkConfig } from '@/lib/relay-policy'

/**
 * Regression coverage for the self-hosted instance-config PR: `/api/config`
 * always returns a relay set now (`publicRelays` defaults to
 * DEFAULT_PUBLIC_RELAYS), so "no zap override configured" cannot be detected
 * from absence. Treating the instance relay set as a *replacement* for the
 * dedicated zap relays dropped relay.coinos.io / nwc.primal.net /
 * relay.primal.net out of the zap-monitoring NDK on production, so zap
 * receipts published only there went undetected and invoices stayed pending.
 *
 * The zap relay set is derived at the same seam as the read set, so it is
 * asserted here rather than through the NDK store: several co-running test
 * files `mock.module('@/lib/stores/ndk')`, and bun applies module mocks
 * process-wide (see AGENTS.md "Test Isolation").
 */
describe('computeNdkConfig zap relay set', () => {
	test('keeps ZAP_RELAYS when the instance configures its own publicRelays', () => {
		const config = computeNdkConfig({
			stage: 'production',
			appRelay: 'wss://app.selfhost.example',
			publicRelays: ['wss://relay.selfhost.example'],
		})

		ZAP_RELAYS.forEach((relay) => expect(config.zapRelayUrls).toContain(relay))
		expect(config.zapRelayUrls).toContain('wss://relay.selfhost.example')
		expect(config.zapRelayUrls).toContain('wss://app.selfhost.example')
	})

	test('keeps ZAP_RELAYS for an unmodified deployment using the shipped publicRelays', () => {
		const config = computeNdkConfig({
			stage: 'production',
			appRelay: 'wss://relay.plebeian.market',
			publicRelays: [...DEFAULT_PUBLIC_RELAYS],
		})

		ZAP_RELAYS.forEach((relay) => expect(config.zapRelayUrls).toContain(relay))
		DEFAULT_PUBLIC_RELAYS.forEach((relay) => expect(config.zapRelayUrls).toContain(relay))
	})
})
