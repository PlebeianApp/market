import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuctionContext } from '../../../src/server/auction/context'
import { buildAuctionPathGrant } from '../../../src/server/auction/grants'
import { getClientPubkeyOrThrow, structuredErrorResult, type ToolHandlerExtra } from './shared'

interface RequestPathArgs {
	auctionEventId: string
	auctionCoordinates: string
	bidderRefundPubkey: string
	intendedAmount: number
}

/**
 * MCP handler for `request_path` — Bidder asks the issuer to allocate a
 * derivation path for a new bid. Replaces the kind-14
 * `auction_path_request_v1` DM and the legacy HTTP endpoint.
 */
export const createRequestPathHandler = (ctx: AuctionContext) => {
	return async (args: RequestPathArgs, extra: ToolHandlerExtra): Promise<CallToolResult> => {
		try {
			const bidderPubkey = getClientPubkeyOrThrow(extra)
			const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
			const grant = await buildAuctionPathGrant(ctx, {
				requestId,
				auctionEventId: args.auctionEventId,
				auctionCoordinates: args.auctionCoordinates,
				bidderPubkey,
				bidderRefundPubkey: args.bidderRefundPubkey,
				intendedAmount: args.intendedAmount,
			})
			return {
				content: [],
				structuredContent: {
					grantId: grant.grantId,
					derivationPath: grant.derivationPath,
					childPubkey: grant.childPubkey,
					xpub: grant.xpub,
					pathIssuerPubkey: grant.pathIssuerPubkey,
					issuedAt: grant.issuedAt,
					expiresAt: grant.expiresAt,
					// AUCTIONS.md §6.1 — the curve-aware floor the issuer
					// enforced at request time. Bidder UI surfaces this
					// so the next click can be priced correctly.
					acceptedFloor: grant.acceptedFloor,
				},
			}
		} catch (error) {
			// Floor / window / auth rejections are normal protocol-level
			// outcomes; printing the full Error object spams the dev console
			// with stack traces for what's basically "client retried with
			// stale state." Just log the message.
			const message = error instanceof Error ? error.message : String(error)
			console.warn('[auction] request_path rejected:', message)
			return structuredErrorResult(error)
		}
	}
}
