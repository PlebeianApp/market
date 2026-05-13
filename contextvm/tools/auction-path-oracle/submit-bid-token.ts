import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { AUCTION_BID_TOKEN_TOPIC, type AuctionBidTokenEnvelope } from '../../../src/lib/auctionTransfers'
import { buildAuctionPathRegistry, findAuctionPathEntryByChildPubkey, upsertAuctionPathEntry } from '../../../src/lib/auctionPathOracle'
import { getAuctionMaxEndAt, getAuctionSettlementGrace, getAuctionTagValue } from '../../../src/lib/auctionSettlement'
import type { AuctionContext } from '../../../src/server/auction/context'
import { loadAuctionEvent } from '../../../src/server/auction/loadAuction'
import { fetchAuctionPathRegistry, publishAuctionPathRegistry } from '../../../src/server/auction/registry'
import { sha256Hex } from '../../../src/server/util/sha256'
import { getClientPubkeyOrThrow, structuredErrorResult, type ToolHandlerExtra } from './shared'

interface SubmitBidTokenArgs {
	auctionEventId: string
	auctionCoordinates: string
	bidEventId: string
	grantId: string
	lockPubkey: string
	refundPubkey: string
	mintUrl: string
	amount: number
	totalBidAmount: number
	commitment: string
	bidNonce: string
	locktime: number
	token: string
}

/**
 * MCP handler for `submit_bid_token` — Bidder delivers the locked Cashu
 * token after publishing the kind-1023 commitment. Runs the §7
 * envelope-side MUST checks (mint allowlist, locktime invariant, grant
 * binding) and advances the registry entry from `issued` → `locked`.
 *
 * The MCP transport already authenticates the caller (the wrapping
 * kind-25910 / 1059 signer == `bidderPubkey`); we don't need to re-check
 * a NIP-44 envelope signature here. The validation pipeline below mirrors
 * `processAuctionBidTokenEnvelope` minus that step.
 */
export const createSubmitBidTokenHandler = (ctx: AuctionContext) => {
	return async (args: SubmitBidTokenArgs, extra: ToolHandlerExtra): Promise<CallToolResult> => {
		try {
			const bidderPubkey = getClientPubkeyOrThrow(extra)

			const envelope: AuctionBidTokenEnvelope = {
				type: AUCTION_BID_TOKEN_TOPIC,
				auctionEventId: args.auctionEventId,
				auctionCoordinates: args.auctionCoordinates,
				bidEventId: args.bidEventId,
				bidderPubkey,
				sellerPubkey: '',
				pathIssuerPubkey: ctx.issuerPubkey,
				refundPubkey: args.refundPubkey,
				lockPubkey: args.lockPubkey,
				locktime: args.locktime,
				mintUrl: args.mintUrl,
				amount: args.amount,
				totalBidAmount: args.totalBidAmount,
				commitment: args.commitment,
				bidNonce: args.bidNonce,
				grantId: args.grantId,
				token: args.token,
				createdAt: Math.floor(Date.now() / 1000),
			}

			const result = await validateAndLockBidToken(ctx, envelope)
			return {
				content: [],
				structuredContent: {
					bidEventId: args.bidEventId,
					registryStatus: result.locked ? 'locked' : 'rejected',
					...(result.reason ? { rejectReason: result.reason } : {}),
				},
			}
		} catch (error) {
			console.warn('[auction] submit_bid_token failed:', error)
			return structuredErrorResult(error)
		}
	}
}

async function validateAndLockBidToken(
	ctx: AuctionContext,
	envelope: AuctionBidTokenEnvelope,
): Promise<{ locked: boolean; reason?: string }> {
	if (envelope.pathIssuerPubkey !== ctx.issuerPubkey) {
		return { locked: false, reason: 'pathIssuerPubkey does not match this server' }
	}

	const tokenCommitment = await sha256Hex(envelope.token)
	if (tokenCommitment !== envelope.commitment) {
		return { locked: false, reason: 'token/commitment mismatch' }
	}

	let auctionEvent
	try {
		auctionEvent = await loadAuctionEvent(ctx, envelope.auctionEventId)
	} catch (error) {
		return { locked: false, reason: error instanceof Error ? error.message : 'cannot resolve auction' }
	}

	const now = Math.floor(Date.now() / 1000)
	const startAt = Number(getAuctionTagValue(auctionEvent, 'start_at') || 0)
	const maxEndAt = getAuctionMaxEndAt(auctionEvent)
	if (startAt && now < startAt) return { locked: false, reason: 'auction has not started' }
	if (maxEndAt && now >= maxEndAt) return { locked: false, reason: 'auction past hard bidding cutoff' }

	const trustedMints = new Set(auctionEvent.tags.filter((tag) => tag[0] === 'mint' && !!tag[1]).map((tag) => tag[1]))
	if (!trustedMints.has(envelope.mintUrl)) return { locked: false, reason: 'mint not in seller allowlist' }

	const settlementGrace = getAuctionSettlementGrace(auctionEvent)
	const expectedLocktime = maxEndAt && settlementGrace ? maxEndAt + settlementGrace : 0
	if (expectedLocktime > 0 && envelope.locktime !== expectedLocktime) {
		return { locked: false, reason: `locktime mismatch (got ${envelope.locktime}, want ${expectedLocktime})` }
	}

	const xpub = getAuctionTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!xpub) return { locked: false, reason: 'auction missing p2pk_xpub' }

	const registry = await fetchAuctionPathRegistry(ctx, envelope.auctionEventId)
	const entry = findAuctionPathEntryByChildPubkey(registry, envelope.lockPubkey)
	if (!entry) return { locked: false, reason: 'lockPubkey not in registry (no matching grant)' }
	if (entry.bidderPubkey !== envelope.bidderPubkey) return { locked: false, reason: 'registry bidder mismatch' }

	// Idempotent: already locked to this bidEventId — treat as success.
	// We re-write the lockPayload on the second call so a retry that
	// supplied a corrected token (e.g. wallet recomputed after a partial
	// failure) overwrites stale data, while a true duplicate is a no-op.
	if (entry.status === 'locked' && entry.bidEventId === envelope.bidEventId && entry.lockPayload?.token === envelope.token) {
		return { locked: true }
	}

	// AUCTIONS.md §7.5.2: the locked Cashu token now lives on the registry
	// entry instead of the legacy kind-14 DM envelope. Settlement reads
	// from here to release tokens to the seller — `request_settlement`
	// no longer fetches kind-14s. The registry blob is NIP-44 encrypted
	// to the issuer's own pubkey, so the token stays issuer-private at
	// rest.
	const updatedEntries = upsertAuctionPathEntry(registry?.entries ?? [], {
		...entry,
		status: 'locked',
		bidEventId: envelope.bidEventId,
		lockPayload: {
			mintUrl: envelope.mintUrl,
			amount: envelope.amount,
			totalBidAmount: envelope.totalBidAmount,
			commitment: envelope.commitment,
			bidNonce: envelope.bidNonce,
			locktime: envelope.locktime,
			refundPubkey: envelope.refundPubkey,
			token: envelope.token,
		},
	})
	await publishAuctionPathRegistry(
		ctx,
		buildAuctionPathRegistry({
			auctionEventId: envelope.auctionEventId,
			auctionCoordinates: envelope.auctionCoordinates || registry?.auctionCoordinates || '',
			xpub,
			entries: updatedEntries,
		}),
	)
	return { locked: true }
}
