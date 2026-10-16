/**
 * currency/transport.ts — **the one seam this module reads the CVM through**.
 *
 * The module owns *what to ask the CVM and what its answer means*; it owns nothing
 * about *how the bytes travel*. Every byte-adjacent concern — opening a relay
 * socket, signing a gift-wrap, correlating a response — lives behind this port.
 * The production implementation is `./nostrTransport` (which wires
 * `@contextvm/sdk`'s `NostrClientTransport`); a test passes a hand-written object
 * with canned answers.
 *
 * That split is what makes the module **offline-testable** (ADR-0005, "no external
 * service dependencies in tests"): the suite never dials a relay, because there is
 * no code path from this module to a socket that does not go through a value a
 * test supplied.
 *
 * The port's shape is deliberately the MCP client's own `callTool` shape, so the
 * production adapter is a pass-through rather than a re-invented protocol — and so
 * `src/lib/ctxcn-clients/PlebeianServerClient.ts:125-138` (the repo's existing CVM
 * client) stays recognisable underneath it instead of being duplicated.
 */

import type { CvmEndpoint } from './endpoint'

/** One tool invocation: the tool's name and its arguments. */
export type CvmToolCall = {
	readonly name: string
	readonly arguments: Readonly<Record<string, unknown>>
}

/**
 * The CVM's answer, split by **whether the call reached the server at all**.
 *
 * `ok: true` with `isError: true` is a server that answered and refused — a
 * tool-level error. `ok: false` is a call that never completed — an unreachable
 * relay, a closed transport, a thrown signer. The reader maps the two to different
 * named states, which is why the distinction is in the type and not in a message
 * string.
 */
export type CvmToolAnswer =
	| { readonly ok: true; readonly structured: unknown; readonly isError: boolean }
	| { readonly ok: false; readonly reason: 'transport-error'; readonly detail: string }

/** A live CVM connection, as this module uses it. */
export interface CvmRateTransport {
	/** Invoke one tool. Must not throw for a server-side refusal — that is `ok: true, isError: true`. */
	callTool(call: CvmToolCall): Promise<CvmToolAnswer>
	/** Release the connection. Called by the reader once per read, success or failure. */
	close(): Promise<void>
}

/**
 * Build a transport **from the endpoint it is handed**.
 *
 * A factory rather than an instance, precisely so that the endpoint the app
 * injected is the one the transport is built from — a test can observe the argument
 * and prove the module used what it was given rather than a constant.
 */
export type CvmRateTransportFactory = (endpoint: CvmEndpoint) => CvmRateTransport
