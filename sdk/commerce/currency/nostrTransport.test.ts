/**
 * nostrTransport.test.ts — **the production adapter, held without a relay**.
 *
 * The adapter is the one file that wires the installed `@contextvm/sdk`
 * (`NostrClientTransport` + `ApplesauceRelayPool` + an MCP `Client`) behind the
 * module's transport port. What is asserted here is the part that is this module's
 * own: **it validates the endpoint before it constructs anything**, so a bad endpoint
 * fails loudly at the composition root instead of dialling nothing, and a good one
 * yields a transport object. `ApplesauceRelayPool` opens its sockets lazily, so
 * holding one touches no network — which is what keeps this file inside ADR-0005.
 *
 * The proof that the SDK transport is built from the **injected** endpoint is
 * `rate.test.ts`'s: the factory is a function of its endpoint argument, and the test
 * asserts on the argument. That is deliberate — reaching into the SDK's private
 * state would test the SDK, not this module.
 *
 * **The mutations that turn each case red:** drop the `validateCvmEndpoint` call from
 * the adapter → the two refusal cases construct a client and stop throwing; default
 * an empty relay list to a public relay → the `relay-urls-empty` case stops throwing.
 */
import { describe, expect, test } from 'bun:test'

import { CvmEndpointRefusalError, createNostrCvmTransportFactory } from './index'
import type { CvmEndpoint } from './endpoint'

/** A valid secp256k1 scalar, so the SDK's signer construction is exercised for real. */
const SIGNER_KEY = '1'.padEnd(64, '0')

describe('the production ContextVM transport adapter', () => {
	test('refuses an endpoint it was not given, before any client is constructed', () => {
		const factory = createNostrCvmTransportFactory({ signer: SIGNER_KEY })
		let thrown: unknown
		try {
			factory(undefined as unknown as CvmEndpoint)
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeInstanceOf(CvmEndpointRefusalError)
		expect((thrown as CvmEndpointRefusalError).reason).toBe('endpoint-missing')
	})

	test('refuses an endpoint with no relay rather than dialling a fallback', () => {
		const factory = createNostrCvmTransportFactory({ signer: SIGNER_KEY })
		let thrown: unknown
		try {
			factory({ serverPubkey: 'a'.repeat(64), relayUrls: [] })
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeInstanceOf(CvmEndpointRefusalError)
		expect((thrown as CvmEndpointRefusalError).reason).toBe('relay-urls-empty')
	})

	test('builds a transport from a valid injected endpoint without dialling a relay', () => {
		const factory = createNostrCvmTransportFactory({ signer: SIGNER_KEY, relayHandler: [] })
		const transport = factory({ serverPubkey: 'a'.repeat(64), relayUrls: ['wss://relay.plebeian.market'] })
		expect(typeof transport.callTool).toBe('function')
		expect(typeof transport.close).toBe('function')
	})
})
