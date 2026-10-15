import { describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import { parseMarketConfig } from './marketConfig'
import { createWorkflowError, ValidationError } from './errors'
import * as sdk from './index'

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

	// The three cases that used the retired seed names — `validateWithSchema` (moved to the rung,
	// proved at `sdk/core/composition/ts/schema.test.ts`), `validateEventWithSchema` (retired: the
	// engine routes by kind, so its kind check has no separate rule), and `EventSchemaRegistry`
	// (whose per-kind one-owner rule becomes V2's registry guard, with its cases) — went with the
	// shadowing file `sdk/core/validation.ts` (design.md §5). Nothing replaced them here, because
	// nothing here is the rule any more: the rule lives at the rung.

	test('the barrel reaches the validation module directory and keeps the two ValidationErrors distinct', () => {
		// The retired file meant `./validation` resolved to a FILE while the landed module directory
		// was unreachable. With the file gone, `sdk/core/index.ts` cites `./validation/ts/index` — the
		// module — and aliases the module's own `ValidationError`, so the two same-named classes cannot
		// shadow each other in the one export surface.
		// The mutation that turns this red: re-export the module's `ValidationError` verbatim (then
		// `sdk.ValidationModuleError` is undefined), or leave the file in place (then `createValidator`
		// would not be the module's).
		expect(sdk.ValidationError).toBe(ValidationError) // the SDK's own
		expect(sdk.ValidationModuleError).not.toBe(sdk.ValidationError) // the module's, a distinct class
		expect(sdk.ValidationModuleError.name).toBe('ValidationError')
		expect(sdk.createValidator).toBeFunction()
		expect(sdk.PASS_THROUGH.name).toBe('pass-through')
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
