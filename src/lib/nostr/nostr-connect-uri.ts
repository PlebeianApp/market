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
 * Positions in the NIP-46 positional-array `params` form that this app admits
 * as the connect secret.
 *
 * nips/46.md defines `connect` as
 * `[<remote-signer-pubkey>, <optional_secret>, <optional_requested_perms>,
 * <optional_client_metadata>]`, so the spec position for the secret is index
 * **1**. Index **0** is this app's own `[<secret>, …]` shorthand (the shape
 * this repo's NIP-46 fixtures use). A match at either position still requires
 * the exact temp secret, so the union admits no sender that could not already
 * produce the secret — it widens reachability, never the credential.
 */
const CONNECT_SECRET_ARRAY_POSITIONS = [1, 0] as const

/** A non-empty string, or `undefined` — the only value any secret slot may yield. */
function readSecretSlot(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Extract the connection secret from an inbound `connect` message's `params`.
 *
 * Accepted shapes (ADR-0002 B-4 / #807 — reads `secret` only, NEVER a legacy
 * `token`):
 *
 * - the spec positional array `[<remote-signer-pubkey>, <secret>, …]` — the
 *   secret is at index 1 (nips/46.md), with the signer's pubkey at index 0;
 * - the app's own single-element `[<secret>]` shorthand — the secret is at
 *   index 0, and is the only element;
 * - the object `{ secret }` form this repo's NIP-46 fixtures and the e2e mock
 *   use.
 *
 * This is the single-value reader. `isMatchingConnectSecret` is the gate and
 * checks BOTH array positions, so the app's `[<secret>]` shorthand keeps
 * working. Returns `undefined` when no secret is present, which the caller
 * treats as "not approved".
 */
export function extractConnectSecret(params: unknown): string | undefined {
	if (Array.isArray(params)) {
		// Spec position first (index 1), then the app's own `[<secret>]`
		// shorthand (index 0).
		for (const index of CONNECT_SECRET_ARRAY_POSITIONS) {
			const secret = readSecretSlot(params[index])
			if (secret !== undefined) return secret
		}
		return undefined
	}

	if (params && typeof params === 'object') {
		const { secret } = params as Record<string, unknown>
		return readSecretSlot(secret)
	}

	return undefined
}

/**
 * Validate a decrypted connect request's params against the expected secret.
 * Accepts ONLY the spec `secret` (positional array at index 1, the app's own
 * index-0 shorthand, or the object form) — a legacy `token`-only request is a
 * mismatch (fail closed, ADR-0002 B-4 / #807).
 */
export function isMatchingConnectSecret(params: unknown, tempSecret: string): boolean {
	if (!tempSecret) return false

	if (Array.isArray(params)) {
		return CONNECT_SECRET_ARRAY_POSITIONS.some((index) => readSecretSlot(params[index]) === tempSecret)
	}

	return extractConnectSecret(params) === tempSecret
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
