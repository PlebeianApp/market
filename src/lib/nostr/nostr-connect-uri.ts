/**
 * NostrConnect URI emit + inbound-secret/approval helpers (ADR-0002 B-4, #807).
 *
 * The `nostrconnect://` spec carries the connection secret in the `secret`
 * query param. A legacy `token=`-only URI must fail closed — the library's
 * `parseNostrConnectURI` is the backstop that THROWS on a missing `secret`,
 * and we never emit a `token=` param ourselves. These helpers are the
 * app-side seam the NostrConnectQR component delegates to, so #807 is
 * enforced in one testable place instead of inline in the component.
 *
 * The seam also owns the QR signer-approval gate ported from #1290
 * (`isApprovedNostrConnectResponse`): a login may only be bound to a signer
 * that already echoed the temp secret, so a bare `ack` from an unrelated relay
 * peer can never bind the session to its own bunker.
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
	/** The connection secret (emitted as `secret=`, ADR-0002 B-4 / #807). */
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
	// output (ADR-0002 B-4 / #807 fail-closed).
	parseNostrConnectURI(uri)
	return uri
}

/**
 * Extract the connection secret from an inbound `connect` message's `params`.
 *
 * NIP-46 defines `params` as a POSITIONAL ARRAY of strings and the
 * signer-initiated `connect` carries the secret first
 * (`connect` → `[<remote-signer-pubkey>, <optional_secret>, …]`), so the array
 * form is the spec shape. The app's own NIP-46 e2e mock (and the pre-#1252
 * lane) used an object `{ secret }`; both shapes are accepted, because a real
 * signer may use either. A legacy `token`-only request is NEVER accepted
 * (ADR-0002 B-4 / #807 — fail closed). Returns `undefined` when no secret is
 * present, which the caller treats as "not approved".
 */
export function extractConnectSecret(params: unknown): string | undefined {
	if (Array.isArray(params)) {
		const [secret] = params
		return typeof secret === 'string' && secret.length > 0 ? secret : undefined
	}

	if (params && typeof params === 'object') {
		const { secret } = params as Record<string, unknown>
		return typeof secret === 'string' && secret.length > 0 ? secret : undefined
	}

	return undefined
}

/**
 * Validate a decrypted connect request's params against the expected secret.
 * Accepts ONLY the spec `secret` (positional array or object form) — a legacy
 * `token`-only request is a mismatch (fail closed, ADR-0002 B-4 / #807).
 */
export function isMatchingConnectSecret(params: unknown, tempSecret: string): boolean {
	if (!tempSecret) return false
	const secret = extractConnectSecret(params)
	return secret !== undefined && secret === tempSecret
}

/**
 * Signer-approval gate for the `nostrconnect://` (QR) lane (#1290).
 *
 * A response may only bind the login when its AUTHOR is a signer that already
 * proved it holds the temp secret (`approvedSignerPubkeys`, populated when that
 * signer's `connect` echoed the secret) and the decrypted `result` is either
 * the secret echo or the approval `ack`.
 *
 * Without this gate a bare `ack` from ANY relay peer that can encrypt to the
 * (public) client pubkey would start the login and bind the session to that
 * peer's bunker — the secret would never be checked. The gate is what makes
 * `secret` the authentication factor the spec says it is (nips/46.md:
 * "`secret` value MUST be provided to avoid connection spoofing").
 */
export function isApprovedNostrConnectResponse(
	result: unknown,
	tempSecret: string,
	signerPubkey: string,
	approvedSignerPubkeys: ReadonlySet<string>,
): boolean {
	return approvedSignerPubkeys.has(signerPubkey) && (result === tempSecret || result === 'ack')
}
