import type { AuctionSettlementPublishStatus } from '../../lib/auctionSettlement'
import { resolvePublicRequestUrl, verifyNip98HttpAuth } from '../../lib/nip98'
import { buildAuctionPathGrant } from '../auction/grants'
import { loadAuctionEvent } from '../auction/loadAuction'
import { buildAuctionSettlementPlan } from '../auction/settlement'
import { jsonError } from '../util/httpResponses'
import type { BunRoutes } from './types'

/**
 * Privileged auction issuer endpoints. Both require NIP-98 HTTP-Auth — see
 * AUCTIONS.md §7.5.1 / §7.5.3. The auth check covers caller identity; the
 * domain functions then enforce the spec's MUST list (mint allowlist,
 * locktime invariant, etc.).
 */
export const auctionRoutes: BunRoutes = {
	'/api/auctions/path-request': {
		POST: async (req) => {
			// Read the body as raw text first so we can both
			// (a) hash it for the NIP-98 `payload` tag check, and
			// (b) JSON-parse it after auth passes.
			const rawBody = await req.text()

			let body: {
				requestId?: string
				auctionEventId?: string
				auctionCoordinates?: string
				bidderPubkey?: string
				bidderRefundPubkey?: string
			}
			try {
				body = (rawBody ? JSON.parse(rawBody) : {}) as typeof body
			} catch {
				return jsonError('Invalid JSON body', 400)
			}

			if (!body.auctionEventId || !body.bidderPubkey || !body.bidderRefundPubkey) {
				return jsonError('auctionEventId, bidderPubkey, and bidderRefundPubkey are required', 400)
			}

			// AUCTIONS.md §7.5.1: "Verify bidderPubkey matches the signer
			// of the wrapping kind 14 DM." We accept the equivalent NIP-98
			// HTTP-Auth proof: the caller signs a kind-27235 event whose
			// pubkey we then require to match `body.bidderPubkey`.
			let authedPubkey: string
			try {
				const auth = await verifyNip98HttpAuth({
					authorizationHeader: req.headers.get('authorization'),
					requestUrl: resolvePublicRequestUrl(req),
					method: 'POST',
					body: rawBody,
				})
				authedPubkey = auth.pubkey
			} catch (error) {
				return jsonError(error instanceof Error ? error.message : 'NIP-98 authentication failed', 401)
			}
			if (authedPubkey !== body.bidderPubkey) {
				return jsonError('Authenticated pubkey does not match bidderPubkey', 403)
			}

			try {
				const grant = await buildAuctionPathGrant({
					requestId: body.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
					auctionEventId: body.auctionEventId,
					auctionCoordinates: body.auctionCoordinates || '',
					bidderPubkey: body.bidderPubkey,
					bidderRefundPubkey: body.bidderRefundPubkey,
				})
				return Response.json(grant)
			} catch (error) {
				console.error('Auction path request failed:', error)
				return jsonError(error instanceof Error ? error.message : 'Failed to issue auction path grant', 400)
			}
		},
	},
	'/api/auctions/settlement-plan': {
		POST: async (req) => {
			const rawBody = await req.text()

			let body: { auctionEventId?: string; auctionCoordinates?: string; status?: AuctionSettlementPublishStatus }
			try {
				body = (rawBody ? JSON.parse(rawBody) : {}) as typeof body
			} catch {
				return jsonError('Invalid JSON body', 400)
			}

			if (!body.auctionEventId) {
				return jsonError('auctionEventId is required', 400)
			}
			if (body.status !== undefined && body.status !== 'settled' && body.status !== 'reserve_not_met') {
				return jsonError('status must be "settled" or "reserve_not_met" when provided', 400)
			}

			// AUCTIONS.md §7.5.3: "the seller requesting the release is
			// the auction author." Verify the NIP-98 signer pubkey
			// matches the auction event's pubkey before doing any
			// expensive work (relay fetches, registry decrypts).
			let authedPubkey: string
			try {
				const auth = await verifyNip98HttpAuth({
					authorizationHeader: req.headers.get('authorization'),
					requestUrl: resolvePublicRequestUrl(req),
					method: 'POST',
					body: rawBody,
				})
				authedPubkey = auth.pubkey
			} catch (error) {
				return jsonError(error instanceof Error ? error.message : 'NIP-98 authentication failed', 401)
			}

			try {
				const auctionEvent = await loadAuctionEvent(body.auctionEventId)
				if (auctionEvent.pubkey !== authedPubkey) {
					return jsonError('Only the auction author can request a settlement plan', 403)
				}
				const plan = await buildAuctionSettlementPlan({
					auctionEventId: body.auctionEventId,
					auctionCoordinates: body.auctionCoordinates,
					status: body.status,
				})
				return Response.json(plan)
			} catch (error) {
				console.error('Auction settlement planning failed:', error)
				return jsonError(error instanceof Error ? error.message : 'Failed to build auction settlement plan', 400)
			}
		},
	},
}
