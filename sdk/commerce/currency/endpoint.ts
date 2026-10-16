/**
 * currency/endpoint.ts — **where the production CVM lives, and who decides it**.
 *
 * **The rule (`D-CVM-ENDPOINT`).** The ContextVM oracle this module reads from is
 * identified by exactly two things: the server's **public key** and the **relay
 * URLs** the client speaks to it over. Both are **configuration the host app
 * injects** — never a constant here.
 *
 * Why that is the rule and not a preference: the application that exists today
 * hard-codes both, at `src/lib/ctxcn-clients/PlebeianServerClient.ts:79-80`
 * (`SERVER_PUBKEY`, `DEFAULT_RELAYS = ['ws://localhost:10547']`) and again at
 * `scripts/fetch-btc-price.ts:5` (`ws://100.90.22.201:10547`). A module that kept
 * its own copy would price goods from whichever oracle answered at that address
 * on the machine it happened to run on — in production that is not a fallback,
 * it is a second, silent source of the number a shopper is charged.
 *
 * **An absent or malformed endpoint is a named refusal, never a default.** Every
 * branch below answers `{ ok: false, reason }` with a reason a caller can render
 * and a reader can act on. There is deliberately **no** `?? 'ws://localhost:10547'`
 * anywhere in this module: the only way to reach a CVM is to have been given one.
 *
 * **Assumption surfaced (see `./assumptions`):** `cvm-endpoint-identifies-the-server`.
 */

/** The ContextVM oracle, as the app declares it. */
export interface CvmEndpoint {
	/** The CVM server's identity. Hex `pubkey`, `npub`, or `nprofile`, per the transport's own contract. */
	readonly serverPubkey: string
	/** The relays the client reaches that server over. At least one. */
	readonly relayUrls: readonly string[]
}

/** Why an endpoint cannot be used. Each is its own state; none is "use a default instead". */
export type CvmEndpointRefusalReason =
	| 'endpoint-missing'
	| 'server-pubkey-missing'
	| 'server-pubkey-invalid'
	| 'relay-urls-empty'
	| 'relay-url-invalid'

/** A named refusal to use an endpoint. */
export type CvmEndpointRefusal = {
	readonly ok: false
	readonly reason: CvmEndpointRefusalReason
	readonly detail: string
}

/** The endpoint the caller gave, or the named reason it cannot be used. */
export type CvmEndpointResult = { readonly ok: true; readonly endpoint: CvmEndpoint } | CvmEndpointRefusal

/**
 * The error a transport factory raises when it is handed an endpoint it cannot use.
 *
 * Distinct from the reader's `unavailable` state on purpose: wiring a bad endpoint
 * into a transport is a **programming error at the composition root**, while a
 * transport that fails at run time is a **named, survivable state**. Only the
 * second is a data outcome.
 */
export class CvmEndpointRefusalError extends Error {
	readonly reason: CvmEndpointRefusalReason

	constructor(refusal: CvmEndpointRefusal) {
		super(refusal.detail)
		this.name = 'CvmEndpointRefusalError'
		this.reason = refusal.reason
	}
}

/** A 64-hex-char Nostr public key, or the bech32 forms the ContextVM transport also accepts. */
const SERVER_IDENTITY = /^(?:[0-9a-f]{64}|npub1[0-9a-z]+|nprofile1[0-9a-z]+)$/i

/** A websocket relay URL. `ws://` and `wss://` are the two the transport can dial. */
const RELAY_URL = /^wss?:\/\/[^\s/]+[^\s]*$/i

/**
 * Validate the endpoint the app injected.
 *
 * Pure: no clock, no socket, no `process.env`, no global default. Every branch is
 * reachable from a fixture, which is what makes "the module uses the endpoint it
 * was given" a testable fact rather than a hope.
 */
export function validateCvmEndpoint(raw: Partial<CvmEndpoint> | undefined | null): CvmEndpointResult {
	if (!raw) {
		return {
			ok: false,
			reason: 'endpoint-missing',
			detail:
				'No CVM endpoint was configured. The app must pass the production endpoint (server pubkey + relay URLs) into the module; this module carries no default endpoint of its own.',
		}
	}

	const serverPubkey = typeof raw.serverPubkey === 'string' ? raw.serverPubkey.trim() : ''
	if (serverPubkey.length === 0) {
		return {
			ok: false,
			reason: 'server-pubkey-missing',
			detail: 'The CVM endpoint carries no server pubkey, so the client has no server to address its request to.',
		}
	}
	if (!SERVER_IDENTITY.test(serverPubkey)) {
		return {
			ok: false,
			reason: 'server-pubkey-invalid',
			detail: `The CVM endpoint's server identity "${serverPubkey}" is not a 64-character hex pubkey, an npub, or an nprofile.`,
		}
	}

	const relayUrls = Array.isArray(raw.relayUrls)
		? raw.relayUrls.map((url) => (typeof url === 'string' ? url.trim() : '')).filter((url) => url.length > 0)
		: []
	if (relayUrls.length === 0) {
		return {
			ok: false,
			reason: 'relay-urls-empty',
			detail:
				'The CVM endpoint carries no relay URLs. Without a relay the request cannot leave the client, and this module will not substitute a public or localhost relay it was not given.',
		}
	}

	const invalid = relayUrls.find((url) => !RELAY_URL.test(url))
	if (invalid) {
		return {
			ok: false,
			reason: 'relay-url-invalid',
			detail: `The CVM endpoint's relay URL "${invalid}" is not a ws:// or wss:// URL.`,
		}
	}

	return { ok: true, endpoint: Object.freeze({ serverPubkey, relayUrls: Object.freeze([...relayUrls]) }) }
}
