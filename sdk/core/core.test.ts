import { describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import { parseMarketConfig } from './marketConfig'
import { EventSchemaRegistry, validateEventWithSchema, validateWithSchema } from './validation'
import { createWorkflowError } from './errors'

describe('SDK Core validation and config', () => {
	test('normalizes workflow failure and uncertainty metadata without discarding causes', () => {
		const cause = new Error('relay timeout')
		const error = createWorkflowError({ workflow: 'auction_bid', phase: 'publish', status: 'uncertain', error: cause })
		expect(error).toMatchObject({
			name: 'WorkflowError',
			code: 'outcome_uncertain',
			workflow: 'auction_bid',
			phase: 'publish',
			status: 'uncertain',
			message: 'relay timeout',
			cause,
		})
	})

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

	test('routes event validation through a kind registry and rejects missing/duplicate registrations', () => {
		const registry = new EventSchemaRegistry().register({ kind: 30408, parse: (input) => ({ source: input }) })
		expect(registry.validate({ kind: 30408, title: 'Lot' })).toEqual({ ok: true, value: { source: { kind: 30408, title: 'Lot' } } })
		expect(registry.validate({ kind: 30402 })).toMatchObject({ ok: false, error: { path: ['kind'] } })
		expect(() => registry.register({ kind: 30408, parse: (input) => input })).toThrow('already registered')
	})

	// Removed with the hand-built validation layer: `parseNostrEventShape` and
	// `verifyNostrEvent` were deleted with `sdk/core/nostr/eventValidation.ts` and
	// had no replacement in the SDK modules, so this case went with them. Event
	// validation is a known, unbuilt capability — a named gap in the PR body, not
	// something this change silently replaced.

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
		expect(
			parseMarketConfig({
				schemaVersion: 'market-config-v1',
				marketId: 'market',
				name: 'Market',
				displayName: 'Market Display',
				siteUrl: 'https://market.example',
				appRelay: 'wss://app-relay.example',
				relayUrls: ['wss://relay.example'],
				trustedMints: ['https://mint.example'],
				defaultCurrency: 'USD',
			}),
		).toMatchObject({
			ok: true,
			value: {
				marketId: 'market',
				name: 'Market',
				displayName: 'Market Display',
				siteUrl: 'https://market.example/',
				appRelay: 'wss://app-relay.example',
				relayUrls: ['wss://relay.example'],
				trustedMints: ['https://mint.example/'],
				defaultCurrency: 'USD',
			},
		})
	})
})
