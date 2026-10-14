import { describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import { parseMarketConfig } from './marketConfig'
import { parseNostrEventShape, verifyNostrEvent } from './nostr/eventValidation'
import { validateEventWithSchema, validateWithSchema } from './validation'

describe('SDK Core validation and config', () => {
	test('wraps schema success and failure in a Result', () => {
		const schema = { parse: (input: unknown) => ({ value: String(input) }) }
		expect(validateWithSchema(42, schema)).toEqual({ ok: true, value: { value: '42' } })
		expect(
			validateWithSchema('bad', {
				parse: () => {
					throw new Error('invalid input')
				},
			}),
		).toMatchObject({ ok: false, error: { code: 'validation_failed', message: 'invalid input' } })
	})

	test('checks event kind before calling a kind-specific parser', () => {
		let parses = 0
		const result = validateEventWithSchema(
			{ kind: 1 },
			{
				kind: 30408,
				parse: () => {
					parses++
					return 'parsed'
				},
			},
		)

		expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed', path: ['kind'] } })
		expect(parses).toBe(0)
	})

	test('validates event shape separately from id/signature verification', () => {
		const event = finalizeEvent({ kind: 1, created_at: 10, content: 'test', tags: [] }, new Uint8Array(32).fill(1))
		expect(parseNostrEventShape(event).ok).toBe(true)
		expect(verifyNostrEvent(event).ok).toBe(true)
		expect(verifyNostrEvent({ ...event, content: 'tampered' })).toMatchObject({ ok: false })
		expect(parseNostrEventShape({ ...event, sig: 'bad' })).toMatchObject({
			ok: false,
			error: { code: 'validation_failed', path: ['sig'] },
		})
	})

	test('parses and normalizes explicit, versioned market relay targets', () => {
		expect(
			parseMarketConfig({
				schemaVersion: 'market-config-v1',
				marketId: '  example-market ',
				relayUrls: ['WSS://RELAY.EXAMPLE/', 'wss://relay.example'],
			}),
		).toEqual({
			ok: true,
			value: { schemaVersion: 'market-config-v1', marketId: 'example-market', relayUrls: ['wss://relay.example'] },
		})
		expect(
			parseMarketConfig({ schemaVersion: 'market-config-v1', marketId: 'market', relayUrls: ['https://relay.example'] }),
		).toMatchObject({ ok: false, error: { code: 'validation_failed', path: ['relayUrls', 0] } })
	})
})
