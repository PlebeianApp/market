import { NDKEvent, NDKUser, type NDKKind } from '@nostr-dev-kit/ndk'
import type { Event } from 'nostr-tools/pure'
import {
	getAuctionMaxEndAt,
	getAuctionSettlementGrace,
	getAuctionTagValue,
} from '../../lib/auctionSettlement'
import { AUCTION_BID_TOKEN_TOPIC, parseAuctionBidTokenEnvelope } from '../../lib/auctionTransfers'
import {
	buildAuctionPathRegistry,
	findAuctionPathEntryByChildPubkey,
	upsertAuctionPathEntry,
} from '../../lib/auctionPathOracle'
import { ensureInvoiceNdkConnected, getAppAuctionSigner } from '../ndk'
import { getAppPublicKeyOrThrow } from '../runtime'
import { sha256Hex } from '../util/sha256'
import { fetchAuctionPathRegistry, publishAuctionPathRegistry } from './registry'
import { loadAuctionEvent } from './loadAuction'

/**
 * AUCTIONS.md §11 / §7.1 — long-lived issuer-side listener for incoming
 * `auction_bid_token_v1` envelopes. The bidder DM-delivers the locked
 * Cashu token (kind 14) right after publishing the public kind-1023
 * commitment. Without this listener:
 *   - registry entries stay `issued` forever (never advance to `locked`),
 *   - bids that fail spec checks at settlement are only caught after the
 *     UI already showed them as live,
 *   - we have no record of *which* of the granted paths were ever actually
 *     locked vs. abandoned.
 *
 * The listener performs the envelope-side §7 MUST checks. Bid-event-side
 * checks (commitment match, derivation_path absence, mint/locktime tag
 * cross-check) still also run at settlement — defence in depth.
 *
 * Open follow-ups intentionally deferred:
 *   - DLEQ verification of the proofs
 *   - NUT-07 unspent state check at the mint
 *   - sending an explicit ack/reject DM back to the bidder
 *   - cross-checking against the kind-1023 event (currently the listener
 *     trusts the envelope; settlement does the cross-check).
 */
export async function processAuctionBidTokenEnvelope(rawEvent: Event): Promise<void> {
	const ndk = await ensureInvoiceNdkConnected()
	const appSigner = await getAppAuctionSigner()
	const appPubkey = getAppPublicKeyOrThrow()

	const decryptable = new NDKEvent(ndk, rawEvent)
	try {
		await decryptable.decrypt(new NDKUser({ pubkey: rawEvent.pubkey }), appSigner, 'nip44')
	} catch (error) {
		console.warn('[auction] bid-token: failed to decrypt envelope', { id: rawEvent.id, error })
		return
	}
	const envelope = parseAuctionBidTokenEnvelope(decryptable.content)
	if (!envelope) {
		console.warn('[auction] bid-token: malformed envelope', { id: rawEvent.id })
		return
	}

	// §7 MUST — bidder identity matches DM signer.
	if (envelope.bidderPubkey !== rawEvent.pubkey) {
		console.warn('[auction] bid-token: bidderPubkey ≠ DM signer', { id: rawEvent.id })
		return
	}
	if (envelope.pathIssuerPubkey !== appPubkey) return

	// Token integrity: SHA-256(token) == commitment.
	const tokenCommitment = await sha256Hex(envelope.token)
	if (tokenCommitment !== envelope.commitment) {
		console.warn('[auction] bid-token: token/commitment mismatch', { id: rawEvent.id })
		return
	}

	let auctionEvent: NDKEvent
	try {
		auctionEvent = await loadAuctionEvent(envelope.auctionEventId)
	} catch (error) {
		console.warn('[auction] bid-token: cannot resolve auction', { id: rawEvent.id, error })
		return
	}

	// §7 MUST — auction is in active window at envelope receipt time.
	const now = Math.floor(Date.now() / 1000)
	const startAt = Number(getAuctionTagValue(auctionEvent, 'start_at') || 0)
	const maxEndAt = getAuctionMaxEndAt(auctionEvent)
	if (startAt && now < startAt) return
	if (maxEndAt && now >= maxEndAt) return

	// §7 MUST — mint in seller's trusted list.
	const trustedMints = new Set(auctionEvent.tags.filter((tag) => tag[0] === 'mint' && !!tag[1]).map((tag) => tag[1]))
	if (!trustedMints.has(envelope.mintUrl)) {
		console.warn('[auction] bid-token: mint not in allowlist', { id: rawEvent.id, mint: envelope.mintUrl })
		return
	}

	// §4.1 / §6.0 — locktime invariant.
	const settlementGrace = getAuctionSettlementGrace(auctionEvent)
	const expectedLocktime = maxEndAt && settlementGrace ? maxEndAt + settlementGrace : 0
	if (expectedLocktime > 0 && envelope.locktime !== expectedLocktime) {
		console.warn('[auction] bid-token: locktime ≠ max_end_at + settlement_grace', {
			id: rawEvent.id,
			got: envelope.locktime,
			want: expectedLocktime,
		})
		return
	}

	const xpub = getAuctionTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!xpub) return

	// §9.1 — child_pubkey must be in the registry (was actually granted by us).
	const registry = await fetchAuctionPathRegistry(envelope.auctionEventId)
	const entry = findAuctionPathEntryByChildPubkey(registry, envelope.lockPubkey)
	if (!entry) {
		console.warn('[auction] bid-token: child_pubkey not in registry', { id: rawEvent.id, lockPubkey: envelope.lockPubkey })
		return
	}
	if (entry.bidderPubkey !== envelope.bidderPubkey) {
		console.warn('[auction] bid-token: registry bidder mismatch', { id: rawEvent.id })
		return
	}
	// Idempotent: already locked to this bidEventId — nothing to do.
	if (entry.status === 'locked' && entry.bidEventId === envelope.bidEventId) return

	const updatedEntries = upsertAuctionPathEntry(registry?.entries ?? [], {
		...entry,
		status: 'locked',
		bidEventId: envelope.bidEventId,
	})
	await publishAuctionPathRegistry(
		buildAuctionPathRegistry({
			auctionEventId: envelope.auctionEventId,
			auctionCoordinates: envelope.auctionCoordinates || registry?.auctionCoordinates || '',
			xpub,
			entries: updatedEntries,
		}),
	)
	console.log('[auction] bid-token: registry advanced to locked', {
		grantId: entry.grantId,
		bidEventId: envelope.bidEventId,
		amount: envelope.amount,
	})
}

export async function startAuctionBidTokenListener(): Promise<void> {
	const ndk = await ensureInvoiceNdkConnected()
	const appPubkey = getAppPublicKeyOrThrow()
	// Backstop for restarts: replay the last hour. The processor is
	// idempotent (matching `bidEventId` short-circuits), so duplicates
	// from the replay window are harmless.
	const since = Math.floor(Date.now() / 1000) - 60 * 60
	const sub = ndk.subscribe(
		{
			kinds: [14 as NDKKind],
			'#p': [appPubkey],
			'#t': [AUCTION_BID_TOKEN_TOPIC],
			since,
		},
		{ closeOnEose: false },
	)
	sub.on('event', (event: NDKEvent) => {
		void processAuctionBidTokenEnvelope(event.rawEvent() as Event).catch((error) => {
			console.error('[auction] bid-token listener processor crashed:', error)
		})
	})
	console.log('[auction] bid-token listener started, replaying since', new Date(since * 1000).toISOString())
}
