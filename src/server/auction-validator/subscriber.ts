/**
 * Relay subscriber — the validator's I/O front-end. Listens for the
 * four auction event kinds and dispatches each into the right state
 * mutator + publisher pass.
 *
 * Default strategy: subscribe to ALL kind-30408 events on the relay
 * pool and filter for ones that list this validator's pubkey in
 * `auditors`. Auction volume is low; this scales fine and means we
 * don't need a separate discovery mechanism for "which auctions
 * concern me." Switch to a targeted REQ later if volume ever warrants.
 *
 * Subscriptions:
 *   1. kind 30408 (auctions): one open REQ, filter on receipt.
 *   2. kind 1023 (bids): scoped to known auction root event ids via
 *      `#e`. We close + reopen this whenever a new auction lands so
 *      bids on the new auction stream in too.
 *   3. kind 1025 (path releases): same pattern as #2.
 *   4. kind 1024 (settlements): same pattern as #2.
 *
 * Re-subscribing on every new auction is wasteful at scale but easy
 * and correct. A future optimisation is one persistent multi-filter
 * REQ; not worth doing now.
 */

import type { ApplesauceRelayPool } from '@contextvm/sdk'
import { schnorr } from '@noble/curves/secp256k1.js'
import type { NostrEvent } from 'nostr-tools'
import { getEventHash } from 'nostr-tools'
import { AUCTION_BID_KIND, AUCTION_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '../../lib/auction/constants'
import { parseAuctionEvent } from '../../lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '../../lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '../../lib/schemas/auction/settlementEvents'
import { currentTopValidBidAmount } from './lifecycle'
import { recordPathRelease, recordSettlement, upsertAuction, upsertBid, type ValidatorState } from './state'
import { refreshAuctionMintReachability, type MintProbePolicy } from './mintReachability'
import type { createVerdictPublisher } from './publisher'
import type { Nut7Poller } from './nut7Poller'

export interface ValidatorSubscriberDeps {
	state: ValidatorState
	relayPool: ApplesauceRelayPool
	publisher: ReturnType<typeof createVerdictPublisher>
	nut7Poller?: Pick<Nut7Poller, 'refreshBidChain' | 'refreshAuctionReleasedNonterminal'>
	/** Override for "current time" — defaults to `Date.now() / 1000`. */
	now?: () => number
	/** Operator-controlled outbound-network + load policy for mint probes. */
	mintProbePolicy?: MintProbePolicy
	/**
	 * First-observation `observed_at` recovered from the validator's own
	 * prior kind-30440 verdicts on startup (`observedAtRecovery.ts`). When a
	 * bid arrives without an explicit `observedAt` (i.e. from the live
	 * subscription, not a buffered replay), the subscriber prefers the
	 * seed for that `bidEventId` over `now()` so a restart after the auction
	 * closed no longer re-stamps in-window bids to `late_arrival`
	 * (ADR-0003 §2.3 amendment). A bid the validator never saw before has
	 * no seed and falls back to `now()` (correct first observation).
	 */
	seedObservedAt?: Map<string, number>
	logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}

export interface ValidatorSubscriber {
	/** Start all REQ subscriptions. Resolves once the initial REQ is established. */
	start: () => Promise<void>
	/** Stop all REQ subscriptions and detach from the relay pool. */
	stop: () => Promise<void>
	/**
	 * Re-derive + republish verdicts for every tracked bid. Useful as a
	 * "tick" the lifecycle timer can call after time-based transitions
	 * (close window elapsing, fallback delay etc.) where no event
	 * arrival triggers a re-evaluation.
	 */
	republishAll: () => Promise<void>
}

export const createValidatorSubscriber = (deps: ValidatorSubscriberDeps): ValidatorSubscriber => {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
	const logger = deps.logger ?? defaultLogger()

	// Active unsubscribe handles, one per REQ we currently have open.
	const unsubscribes: Array<() => void> = []
	// Buffered bids/releases/settlements that arrived before we knew
	// about their auction. Each carries the validator's first-observed
	// time so replay uses the original sighting, not replay-time now()
	// (which would let relay ordering change prompt/late classification).
	const pendingBids = new Map<string, { raw: NostrEvent; observedAt: number }[]>() // auctionRootEventId → events
	const pendingReleases = new Map<string, { raw: NostrEvent; observedAt: number }[]>() // bidEventId → events
	const pendingSettlements = new Map<string, { raw: NostrEvent; observedAt: number }[]>() // auctionRootEventId → events

	// =========================================================================
	// Event handlers
	// =========================================================================

	const verifyIncomingEvent = (raw: NostrEvent, label: string): boolean => {
		try {
			const expectedId = getEventHash(raw)
			if (expectedId !== raw.id) {
				logger.warn(`[validator] dropping ${label} with mismatched event id ${raw.id.slice(0, 8)}`)
				return false
			}

			const valid = schnorr.verify(
				Uint8Array.from(Buffer.from(raw.sig, 'hex')),
				Uint8Array.from(Buffer.from(expectedId, 'hex')),
				Uint8Array.from(Buffer.from(raw.pubkey, 'hex')),
			)
			if (!valid) {
				logger.warn(`[validator] dropping ${label} with invalid signature ${raw.id.slice(0, 8)}`)
				return false
			}
			return true
		} catch {
			logger.warn(`[validator] dropping ${label} with invalid signature ${raw.id.slice(0, 8)}`)
			return false
		}
	}

	const onAuctionEvent = async (raw: NostrEvent): Promise<void> => {
		if (!verifyIncomingEvent(raw, 'auction')) {
			return
		}

		const parsed = parseAuctionEvent(raw)
		if (!parsed.ok) {
			// Common case: an auction event that isn't compliant with the
			// new scheme (missing `auditors`, wrong settlement_policy etc.).
			// Just drop it silently — the validator only cares about
			// auctions that opted into its audit.
			return
		}
		const auction = parsed.value
		if (!auction.auditors.includes(deps.state.validatorPubkey)) {
			// Auction doesn't list us as an auditor; ignore.
			return
		}

		const existing = deps.state.auctions.get(auction.rootEventId)
		const result = upsertAuction(deps.state, auction)
		if (result.status === 'rejected_immutable') {
			logger.warn(`[validator] rejecting immutable auction update ${auction.rootEventId.slice(0, 8)}`)
			return
		}

		const hasAnyReachableMint = await refreshAuctionMintReachability(result.auctionState, undefined, deps.mintProbePolicy)
		if (!hasAnyReachableMint) {
			logger.warn(`[validator] auction ${auction.rootEventId.slice(0, 8)} has no reachable mints yet`)
		}

		const shouldDrain = result.status === 'inserted'
		if (result.status === 'inserted') {
			logger.info(`[validator] tracking new auction ${auction.dTag.slice(0, 16)} (root=${auction.rootEventId.slice(0, 8)})`)
		}
		if (shouldDrain) {
			// Drain anything we'd buffered for this auction.
			await drainPending(auction.rootEventId)
		}
	}

	const onBidEvent = async (raw: NostrEvent, observedAt?: number): Promise<void> => {
		if (!verifyIncomingEvent(raw, 'bid')) {
			return
		}

		const parsed = parseBidEvent(raw)
		if (!parsed.ok) {
			// Malformed bid → ignore. (Hostile bidders publishing bad
			// events shouldn't crash the validator; a stricter mode could
			// emit an explicit bid_invalid + bad-structure verdict, but
			// without a tracked auction we have no `d` tag to address.)
			return
		}
		const bid = parsed.value
		// Prefer an explicit observedAt (buffered replay preserves the
		// original sighting), then the recovered seed (cross-restart
		// first-observation, Fix 1), then a fresh `now()` (genuine first
		// sight this process). This ordering keeps a single-process
		// buffered sighting authoritative over the relay-recovered value.
		const firstObservedAt = observedAt ?? deps.seedObservedAt?.get(bid.id) ?? now()

		// If the auction hasn't arrived yet on our relay, stash the bid
		// and replay it (with this first-observed time) when the auction
		// shows up.
		if (!deps.state.auctions.has(bid.auctionRootEventId)) {
			const existing = pendingBids.get(bid.auctionRootEventId) ?? []
			existing.push({ raw, observedAt: firstObservedAt })
			pendingBids.set(bid.auctionRootEventId, existing)
			return
		}

		const result = upsertBid(deps.state, bid, firstObservedAt)
		if (!result) return // can't happen — auction is known per the check above

		// Run derive + publish.
		try {
			await deps.publisher.publishIfChanged({
				auctionState: result.auctionState,
				bidState: result.bidState,
				currentTopBid: currentTopValidBidAmount(result.auctionState),
			})
		} catch (err) {
			logger.error(`[validator] verdict publish failed for bid ${bid.id.slice(0, 8)}:`, err instanceof Error ? err.message : err)
		}
	}

	const onPathReleaseEvent = async (raw: NostrEvent, observedAt?: number): Promise<void> => {
		if (!verifyIncomingEvent(raw, 'path release')) {
			return
		}

		const parsed = parsePathReleaseEvent(raw)
		if (!parsed.ok) return
		const release = parsed.value
		const firstObservedAt = observedAt ?? now()

		const recordResult = recordPathRelease(deps.state, release, firstObservedAt)
		if (recordResult.status === 'unknown_bid') {
			// We don't know about this bid yet (auction or bid event
			// hasn't arrived). Stash and replay when the bid appears;
			// authorization is re-applied on replay. Preserve the
			// first-observed time so prompt/late classification is stable.
			const existing = pendingReleases.get(release.bidEventId) ?? []
			existing.push({ raw, observedAt: firstObservedAt })
			pendingReleases.set(release.bidEventId, existing)
			return
		}
		if (recordResult.status === 'wrong_author') {
			// Correctly-signed but not by the bid's bidder. Drop without
			// mutating state, buffering, or publishing a verdict — wrong-author
			// evidence must not change reputation.
			logger.warn(
				`[validator] dropping kind-1025 ${release.id.slice(0, 8)}: signer does not match bidder for bid ${release.bidEventId.slice(0, 8)}`,
			)
			return
		}
		const auctionState = recordResult.auctionState
		const bidState = auctionState.bids.get(release.bidEventId)
		if (!bidState) return // shouldn't happen — recordPathRelease ensures the bid is in the auction

		if (deps.nut7Poller) {
			try {
				await deps.nut7Poller.refreshBidChain({
					auctionRootEventId: auctionState.auction.rootEventId,
					bidEventId: release.bidEventId,
				})
			} catch (err) {
				logger.warn(
					`[validator] kind-1025 NUT-7 refresh failed for bid ${release.bidEventId.slice(0, 8)}:`,
					err instanceof Error ? err.message : err,
				)
			}
		}

		try {
			await deps.publisher.publishIfChanged({
				auctionState,
				bidState,
				currentTopBid: currentTopValidBidAmount(auctionState),
			})
		} catch (err) {
			logger.error(
				`[validator] verdict publish failed after kind-1025 for bid ${release.bidEventId.slice(0, 8)}:`,
				err instanceof Error ? err.message : err,
			)
		}
	}

	const onSettlementEvent = async (raw: NostrEvent, observedAt?: number): Promise<void> => {
		if (!verifyIncomingEvent(raw, 'settlement')) {
			return
		}

		const parsed = parseSettlementEvent(raw)
		if (!parsed.ok) return
		const settlement = parsed.value
		const firstObservedAt = observedAt ?? now()

		const recordResult = recordSettlement(deps.state, settlement)
		if (recordResult.status === 'unknown_auction') {
			const existing = pendingSettlements.get(settlement.auctionRootEventId) ?? []
			existing.push({ raw, observedAt: firstObservedAt })
			pendingSettlements.set(settlement.auctionRootEventId, existing)
			return
		}
		if (recordResult.status === 'wrong_seller') {
			// Correctly-signed but not by the auction seller. Drop without
			// overwriting the settlement slot, buffering, or publishing —
			// wrong-seller evidence must not replace valid seller evidence.
			logger.warn(
				`[validator] dropping kind-1024 ${settlement.id.slice(0, 8)}: signer does not match seller for auction ${settlement.auctionRootEventId.slice(0, 8)}`,
			)
			return
		}
		const auctionState = recordResult.auctionState

		if (deps.nut7Poller) {
			try {
				await deps.nut7Poller.refreshAuctionReleasedNonterminal(auctionState.auction.rootEventId)
			} catch (err) {
				logger.warn(
					`[validator] kind-1024 NUT-7 refresh failed for auction ${auctionState.auction.rootEventId.slice(0, 8)}:`,
					err instanceof Error ? err.message : err,
				)
			}
		}

		// A kind-1024 changes the validator's view of the auction
		// terminal state. Re-evaluate every bid in the auction so
		// late-arriving NUT-7 transitions land in the right verdict
		// (e.g. winner that flipped to spent right as kind-1024 arrived).
		await republishAuction(auctionState.auction.rootEventId)
	}

	// =========================================================================
	// Pending-event replay
	// =========================================================================

	const drainPending = async (auctionRootEventId: string): Promise<void> => {
		const bids = pendingBids.get(auctionRootEventId) ?? []
		pendingBids.delete(auctionRootEventId)
		for (const { raw, observedAt } of bids) await onBidEvent(raw, observedAt)

		const settlements = pendingSettlements.get(auctionRootEventId) ?? []
		pendingSettlements.delete(auctionRootEventId)
		for (const { raw, observedAt } of settlements) await onSettlementEvent(raw, observedAt)

		// Path releases are keyed by bidEventId — after the bids
		// drained above, try replaying every stash and clean up the
		// ones that now resolve.
		for (const [bidEventId, releases] of Array.from(pendingReleases.entries())) {
			const auctionState = deps.state.auctions.get(auctionRootEventId)
			if (auctionState && auctionState.bids.has(bidEventId)) {
				pendingReleases.delete(bidEventId)
				for (const { raw, observedAt } of releases) await onPathReleaseEvent(raw, observedAt)
			}
		}
	}

	const republishAuction = async (auctionRootEventId: string): Promise<void> => {
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return
		const topBid = currentTopValidBidAmount(auctionState)
		for (const bidState of Array.from(auctionState.bids.values())) {
			try {
				await deps.publisher.publishIfChanged({
					auctionState,
					bidState,
					currentTopBid: topBid,
				})
			} catch (err) {
				logger.error(
					`[validator] verdict republish failed for bid ${bidState.bid.id.slice(0, 8)}:`,
					err instanceof Error ? err.message : err,
				)
			}
		}
	}

	// =========================================================================
	// REQ subscription wiring
	// =========================================================================

	const start = async (): Promise<void> => {
		const auctionUnsub = await deps.relayPool.subscribe(
			[{ kinds: [auctionKindAsNumber()], since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30 }],
			(event) => {
				void onAuctionEvent(event)
			},
		)
		unsubscribes.push(auctionUnsub)

		const bidUnsub = await deps.relayPool.subscribe(
			[{ kinds: [bidKindAsNumber()], since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30 }],
			(event) => {
				void onBidEvent(event)
			},
		)
		unsubscribes.push(bidUnsub)

		const releaseUnsub = await deps.relayPool.subscribe(
			[{ kinds: [pathReleaseKindAsNumber()], since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30 }],
			(event) => {
				void onPathReleaseEvent(event)
			},
		)
		unsubscribes.push(releaseUnsub)

		const settlementUnsub = await deps.relayPool.subscribe(
			[{ kinds: [settlementKindAsNumber()], since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30 }],
			(event) => {
				void onSettlementEvent(event)
			},
		)
		unsubscribes.push(settlementUnsub)

		logger.info('[validator] subscriptions established')
	}

	const stop = async (): Promise<void> => {
		while (unsubscribes.length > 0) {
			const off = unsubscribes.pop()
			try {
				off?.()
			} catch {
				// Ignore — pool might already be torn down.
			}
		}
	}

	const republishAll = async (): Promise<void> => {
		for (const auctionState of Array.from(deps.state.auctions.values())) {
			await republishAuction(auctionState.auction.rootEventId)
		}
	}

	return { start, stop, republishAll }
}

// ============================================================================
// Internal helpers
// ============================================================================

// The auction kind constants are typed as a strict union of NDKKind
// values; widen back to number for nostr-tools filter shape.
const auctionKindAsNumber = (): number => AUCTION_KIND as unknown as number
const bidKindAsNumber = (): number => AUCTION_BID_KIND as unknown as number
const pathReleaseKindAsNumber = (): number => AUCTION_PATH_RELEASE_KIND as unknown as number
const settlementKindAsNumber = (): number => AUCTION_SETTLEMENT_KIND as unknown as number

const defaultLogger = () => ({
	info: (...args: unknown[]) => console.log(...args),
	warn: (...args: unknown[]) => console.warn(...args),
	error: (...args: unknown[]) => console.error(...args),
})
