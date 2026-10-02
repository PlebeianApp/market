import { describe, expect, test } from 'bun:test'

import { DEFAULT_NIP46_RELAYS } from '@/lib/constants'
import { nip46RelayOptions } from '@/lib/nostr/nip46-relays'

describe('nip46RelayOptions', () => {
	test('puts the server relay first so it is the default pick', () => {
		const options = nip46RelayOptions('wss://relay.plebeian.market')
		expect(options[0]).toEqual({ value: 'wss://relay.plebeian.market', label: 'relay.plebeian.market' })
	})

	test('adds a non-default server relay and still offers the defaults', () => {
		const options = nip46RelayOptions('wss://relay.example.com')
		expect(options[0]).toEqual({ value: 'wss://relay.example.com', label: 'relay.example.com' })
		for (const relay of DEFAULT_NIP46_RELAYS) {
			expect(options.some((o) => o.value === relay.value)).toBe(true)
		}
	})

	test('dedupes a server relay that is also a default', () => {
		const server = 'wss://relay.plebeian.market'
		const options = nip46RelayOptions(server)
		expect(options.filter((o) => o.value === server)).toHaveLength(1)
	})

	test('falls back to the defaults when no server relay is configured', () => {
		const options = nip46RelayOptions(undefined)
		expect(options.map((o) => o.value)).toEqual(DEFAULT_NIP46_RELAYS.map((r) => r.value))
	})

	test('ignores blank/whitespace server relays', () => {
		expect(nip46RelayOptions('   ').map((o) => o.value)).toEqual(DEFAULT_NIP46_RELAYS.map((r) => r.value))
	})
})
