/**
 * `nostrconnect://` URI emit and inbound-secret helpers, harvested from the
 * market's `src/lib/nostr/nostr-connect-uri.ts` at `4bc7f8c0` — unchanged in
 * behaviour, because its behaviour *is* the invariant.
 *
 * The `nostrconnect://` spec carries the connection secret in the `secret`
 * query param. A legacy `token=`-only URI must fail closed: the library's
 * `parseNostrConnectURI` is the backstop that throws on a missing `secret`, and
 * this module never emits a `token=` param. Both helpers are the seam a login
 * surface delegates to, so the rule is enforced in one testable place instead
 * of inline in a component.
 */
import { parseNostrConnectURI } from 'applesauce-signers/helpers'

/** #92bb8c — NostrConnectUriMetadata: the app metadata an emitted connect URI may carry. */
export interface NostrConnectUriMetadata {
	name?: string
	description?: string
	url?: string
	icons?: string[]
}

/** #92bb8c — BuildNostrConnectUriArgs: the client pubkey, relay, secret and metadata a connect URI is built from. */
export interface BuildNostrConnectUriArgs {
	/** Hex pubkey of the local client the remote signer must reach. */
	clientPubkey: string
	/** Write relay used for the NIP-46 channel. */
	relay: string
	/** The connection secret (emitted as `secret=`). */
	secret: string
	metadata?: NostrConnectUriMetadata
}

/**
 * Build a spec-compliant `nostrconnect://` URI. Emits the secret via the
 * `secret` query param (NOT the legacy `token`), preserving the app's existing
 * `metadata` JSON-blob shape. Throws if the secret is empty — a URI without a
 * secret can never be approved, so fail closed.
 */
/** #92bb8c — buildNostrConnectUri: emit a spec-compliant URI with the secret param, never the legacy token. */
export function buildNostrConnectUri({ clientPubkey, relay, secret, metadata }: BuildNostrConnectUriArgs): string {
	if (!secret) throw new Error('NostrConnect URI requires a connection secret (missing secret)')

	const params = new URLSearchParams()
	params.set('relay', relay)
	if (metadata) params.set('metadata', JSON.stringify(metadata))
	params.set('secret', secret)

	const uri = `nostrconnect://${clientPubkey}?` + params.toString()

	// The emitted URI must round-trip through the library parser. It throws on a
	// missing `secret`, so this rejects any accidental legacy token-only output.
	parseNostrConnectURI(uri)
	return uri
}

/**
 * Validate a decrypted connect request's params against the expected secret.
 * Accepts ONLY the spec `secret` param — a legacy `token`-only request is a
 * mismatch (fail closed).
 */
/** #92bb8c — isMatchingConnectSecret: accept only the spec secret param; a legacy token-only request is a mismatch. */
export function isMatchingConnectSecret(params: unknown, tempSecret: string): boolean {
	if (!params || typeof params !== 'object') return false
	const record = params as Record<string, unknown>
	return record.secret === tempSecret
}
