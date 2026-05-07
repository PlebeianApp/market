import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'

export type ToolHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

/**
 * Shared MCP tool helpers for the english_auction_path_oracle_v1 family.
 *
 * Conventions:
 *   - The bidder/seller pubkey is read from `extra._meta.clientPubkey`,
 *     which the SDK injects when `injectClientPubkey: true` is set on the
 *     `NostrServerTransport`. Using session-level identity (the wrapping
 *     kind-25910 / 1059 signer) closes the §7.5.1 caller-identity hole —
 *     the input schema therefore deliberately does NOT accept a
 *     bidder/seller pubkey field.
 *   - Errors thrown from the domain layer are surfaced as
 *     `{ structuredContent: { error }, isError: true }` so MCP clients see
 *     a proper failure rather than an opaque transport error.
 */

const NOSTR_PUBKEY_HEX_RE = /^[0-9a-f]{64}$/i

export function getClientPubkeyOrThrow(extra: ToolHandlerExtra): string {
	const meta = (extra as { _meta?: Record<string, unknown> })._meta
	const candidate = meta && typeof meta === 'object' ? (meta as { clientPubkey?: unknown }).clientPubkey : undefined
	if (typeof candidate !== 'string' || !NOSTR_PUBKEY_HEX_RE.test(candidate)) {
		throw new Error(
			'Tool requires `injectClientPubkey: true` on the server transport — the caller pubkey is missing from the request _meta',
		)
	}
	return candidate
}

export function structuredErrorResult(error: unknown): CallToolResult {
	const message = error instanceof Error ? error.message : String(error)
	return {
		content: [],
		structuredContent: { error: message },
		isError: true,
	}
}
