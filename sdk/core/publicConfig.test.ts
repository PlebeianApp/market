import { describe, expect, test } from 'bun:test'
import { parsePublicConfigEnvelope, PUBLIC_CONFIG_SCHEMA_VERSION } from './publicConfig'

const valid = { appRelay: 'wss://relay.example', appPublicKey: 'a'.repeat(64), stage: 'production', name: 'Market' }

describe('parsePublicConfigEnvelope', () => {
	test('accepts the current version and keeps extra fields', () => {
		const result = parsePublicConfigEnvelope<{ name: string }>({ ...valid, schemaVersion: PUBLIC_CONFIG_SCHEMA_VERSION })
		expect(result.ok && result.value.name).toBe('Market')
	})

	test('treats a missing version as v1 for hosts deployed before versioning', () => {
		const result = parsePublicConfigEnvelope(valid)
		expect(result.ok && result.value.schemaVersion).toBe(PUBLIC_CONFIG_SCHEMA_VERSION)
	})

	test('rejects unknown versions and malformed required fields', () => {
		expect(parsePublicConfigEnvelope({ ...valid, schemaVersion: 'public-config-v2' }).ok).toBe(false)
		expect(parsePublicConfigEnvelope({ ...valid, appRelay: 'https://relay.example' }).ok).toBe(false)
		expect(parsePublicConfigEnvelope({ ...valid, appPublicKey: 'npub1x' }).ok).toBe(false)
		expect(parsePublicConfigEnvelope({ ...valid, stage: 'prod' }).ok).toBe(false)
		expect(parsePublicConfigEnvelope(null).ok).toBe(false)
	})
})
