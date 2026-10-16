/**
 * currency/nostrTransport.ts — **the production transport: `@contextvm/sdk`, wired to the injected endpoint**.
 *
 * This is the only file in the module that knows a relay socket or a signing key
 * exists. It implements `./transport`'s `CvmRateTransportFactory` over the installed
 * ContextVM client library rather than hand-rolling a client — the same wiring the
 * repository already uses twice, `src/lib/ctxcn-clients/PlebeianServerClient.ts:102-113`
 * (MCP `Client` + `NostrClientTransport` + `ApplesauceRelayPool`) and
 * `scripts/fetch-btc-price.ts:27-35` — with **one deliberate difference**: neither of
 * those takes its server pubkey or its relays from a caller. Here they are the
 * argument. `PlebeianServerClient.SERVER_PUBKEY` and `.DEFAULT_RELAYS` exist precisely
 * because a client had nowhere to be told; this factory has.
 *
 * **Why a factory and not a client.** The factory is handed the endpoint and builds
 * from *it*. That is the seam `rate.test.ts` observes to prove the module uses the
 * endpoint it was given: the tested assertion is on the argument, not on a private
 * field, so no SDK internals have to be reached into.
 *
 * **Assumption surfaced (see `./assumptions`):** `cvm-tool-shape`.
 */

import { Client } from '@modelcontextprotocol/sdk/client'
import { ApplesauceRelayPool, NostrClientTransport } from '@contextvm/sdk'
import type { NostrTransportOptions } from '@contextvm/sdk'

import { CvmEndpointRefusalError, validateCvmEndpoint, type CvmEndpoint } from './endpoint'
import type { CvmRateTransport, CvmRateTransportFactory } from './transport'

export interface NostrCvmTransportOptions {
	/** The client's own Nostr signer, or a hex private key the SDK turns into one. */
	readonly signer: NostrTransportOptions['signer']
	/**
	 * The relay pool to speak through. Omitted in production, where the pool is built
	 * from the **injected endpoint's** relay URLs. A test injects a recording pool here so
	 * no socket is ever dialled.
	 */
	readonly relayHandler?: NostrTransportOptions['relayHandler']
	/** Stateless mode, as the repository's existing client uses it. Defaults to `true`. */
	readonly isStateless?: boolean
}

/**
 * Build a `CvmRateTransportFactory` over the ContextVM SDK.
 *
 * The returned factory validates the endpoint **before** constructing anything, so an
 * endpoint that cannot be dialled raises `CvmEndpointRefusalError` at the composition
 * root rather than opening a socket to nowhere. `ApplesauceRelayPool` creates its
 * connections lazily, so constructing the transport (and this factory) touches no
 * network — which is what lets the suite hold one.
 */
export function createNostrCvmTransportFactory(options: NostrCvmTransportOptions): CvmRateTransportFactory {
	return (endpoint: CvmEndpoint): CvmRateTransport => {
		const checked = validateCvmEndpoint(endpoint)
		if (!checked.ok) throw new CvmEndpointRefusalError(checked)

		const client = new Client({ name: 'plebeian-commerce-currency', version: '1.0.0' })
		const transport = new NostrClientTransport({
			serverPubkey: checked.endpoint.serverPubkey,
			signer: options.signer,
			relayHandler: options.relayHandler ?? new ApplesauceRelayPool([...checked.endpoint.relayUrls]),
			isStateless: options.isStateless ?? true,
		})

		// Connected once, on the first call: the transport's `start()` dials the relay pool,
		// and a factory that connected in its constructor would dial on construction.
		let connected: Promise<void> | undefined

		return {
			async callTool(call) {
				try {
					connected ??= client.connect(transport)
					await connected
					const result = await client.callTool({ name: call.name, arguments: { ...call.arguments } })
					return { ok: true, structured: (result as { structuredContent?: unknown }).structuredContent, isError: result.isError === true }
				} catch (error) {
					// The call did not complete, so this is not a server that answered. A
					// tool-level refusal arrives as `ok: true, isError: true` instead — the
					// MCP client surfaces it as `isError` rather than as a throw.
					return {
						ok: false,
						reason: 'transport-error',
						detail: error instanceof Error ? error.message : String(error),
					}
				}
			},
			async close() {
				await client.close()
			},
		}
	}
}
