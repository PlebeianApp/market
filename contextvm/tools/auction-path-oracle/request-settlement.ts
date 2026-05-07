import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuctionContext } from '../../../src/server/auction/context'
import { loadAuctionEvent } from '../../../src/server/auction/loadAuction'
import { buildAuctionSettlementPlan } from '../../../src/server/auction/settlement'
import { getClientPubkeyOrThrow, structuredErrorResult, type ToolHandlerExtra } from './shared'

interface RequestSettlementArgs {
	auctionEventId: string
	auctionCoordinates?: string
}

/**
 * MCP handler for `request_settlement` — Seller asks the issuer to compute
 * the settlement plan and release the winning derivation paths + locked
 * tokens. Caller identity is the wrapping MCP transport's signer pubkey;
 * we cross-check it against the auction event's `pubkey` (the seller).
 */
export const createRequestSettlementHandler = (ctx: AuctionContext) => {
	return async (args: RequestSettlementArgs, extra: ToolHandlerExtra): Promise<CallToolResult> => {
		try {
			const sellerPubkey = getClientPubkeyOrThrow(extra)

			const auctionEvent = await loadAuctionEvent(ctx, args.auctionEventId)
			if (auctionEvent.pubkey !== sellerPubkey) {
				return structuredErrorResult(new Error('Only the auction author can request a settlement plan'))
			}

			const plan = await buildAuctionSettlementPlan(ctx, {
				auctionEventId: args.auctionEventId,
				auctionCoordinates: args.auctionCoordinates,
			})

			return {
				content: [],
				structuredContent: {
					status: plan.status,
					closeAt: plan.closeAt,
					reserve: plan.reserve,
					finalAmount: plan.finalAmount,
					winningBidEventId: plan.winningBidEventId ?? '',
					winnerPubkey: plan.winnerPubkey ?? '',
					...(plan.releaseId ? { releaseId: plan.releaseId } : {}),
					releases: (plan.winnerTokens || []).map((token) => ({
						bidEventId: token.bidEventId,
						derivationPath: token.derivationPath,
						childPubkey: token.childPubkey,
						bidderPubkey: token.bidderPubkey,
						mintUrl: token.mintUrl,
						amount: token.amount,
						totalBidAmount: token.totalBidAmount,
						commitment: token.commitment,
						locktime: token.locktime,
						refundPubkey: token.refundPubkey,
						token: token.token,
					})),
				},
			}
		} catch (error) {
			console.warn('[auction] request_settlement failed:', error)
			return structuredErrorResult(error)
		}
	}
}
