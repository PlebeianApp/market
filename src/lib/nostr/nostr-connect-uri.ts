/**
 * NostrConnect URI emit + inbound-secret helpers (ADR-0008 B-4, #807).
 *
 * The `nostrconnect://` spec carries the connection secret in the `secret`
 * query param. A legacy `token=`-only URI must fail closed — the library's
 * `parseNostrConnectURI` is the backstop that THROWS on a missing `secret`,
 * and we never emit a `token=` param ourselves. Both helpers are the
 * app-side seam the NostrConnectQR component delegates to, so #807 is
 * enforced in one testable place instead of inline in the component.
 */
import { parseNostrConnectURI } from 'applesauce-signers/helpers'

export interface NostrConnectUriMetadata {
	name?: string
	description?: string
	url?: string
	icons?: string[]
}

export interface BuildNostrConnectUriArgs {
	/** Hex pubkey of the local client the remote signer must reach. */
	clientPubkey: string
	/** Write relay used for the NIP-46 channel. */
	relay: string
	/** The connection secret (emitted as `secret=`, ADR-0008 B-4 / #807). */
	secret: string
	metadata?: NostrConnectUriMetadata
}

/**
 * Build a spec-compliant `nostrconnect://` URI. Emits the secret via the
 * `secret` query param (NOT legacy `token`), preserving the app's existing
 * `metadata` JSON-blob shape. Throws if the secret is empty — a URI without
 * a secret can never be approved, so fail closed.
 */
export function buildNostrConnectUri({ clientPubkey, relay, secret, metadata }: BuildNostrConnectUriArgs): string {
	if (!secret) throw new Error('NostrConnect URI requires a connection secret (missing secret)')

	const params = new URLSearchParams()
	params.set('relay', relay)
	if (metadata) params.set('metadata', JSON.stringify(metadata))
	params.set('secret', secret)

	const uri = `nostrconnect://${clientPubkey}?` + params.toString()

	// The emitted URI must round-trip through the library parser. It THROWS on
	// a missing `secret`, so this rejects any accidental legacy token-only
	// output (ADR-0008 B-4 / #807 fail-closed).
	parseNostrConnectURI(uri)
	return uri
}

/**
 * Validate a decrypted connect request's params against the expected secret.
 * Accepts ONLY the spec `secret` param — a legacy `token`-only request is a
 * mismatch (fail closed, ADR-0008 B-4 / #807).
 */
export function isMatchingConnectSecret(params: unknown, tempSecret: string): boolean {
	if (!params || typeof params !== 'object') return false
	const record = params as Record<string, unknown>
	return record.secret === tempSecret
}
