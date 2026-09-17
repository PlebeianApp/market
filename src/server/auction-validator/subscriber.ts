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
 *   2. kinds 1023/1025/1024 (bids, path releases, settlements): one
 *      REQ per tracked auction, scoped by `#a` to that auction's
 *      canonical coordinate (`30408:<seller>:<d>`). `#e` cannot serve
 *      as the shared child filter here: bids + settlements tag the
 *      auction root in `e`, but kind-1025 path releases tag the BID id
 *      there. All three child kinds do share the auction coordinate in
 *      `a`, so that is the narrow common live filter.
 *
 * Child REQs stay open until the auction is past the validator's own
 * close-time skew window (`max_end_at + max_skew_sec`) AND the tracked
 * bids are terminal AND no buffered children attributable to that
 * auction remain. We enforce closure by calling the unsubscribe handle,
 * not by `until`, so the validator never drops a still-replayable child
 * solely because its local clock advanced.
 */

import type { ApplesauceRelayPool } from '@contextvm/sdk'
import { schnorr } from '@noble/curves/secp256k1.js'
import type { NostrEvent } from 'nostr-tools'
import { getEventHash } from 'nostr-tools'
import { AUCTION_BID_KIND, AUCTION_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '../../lib/auction/constants'
import { parseAuctionEvent } from '../../lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '../../lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '../../lib/schemas/auction/settlementEvents'

import { recordPathRelease, recordSettlement, upsertAuction, upsertBid, type ValidatorState } from './state'
import { createPendingBuffer } from './pendingBuffer'
import { refreshAuctionMintReachability, type MintProbePolicy } from './mintReachability'
import type { createVerdictPublisher } from './publisher'
import type { Nut7Poller } from './nut7Poller'
import { checkBidSpamPolicy, checkEventEnvelope, recordAcceptedBid, resolvePendingBufferLimits, type BidSpamPolicy } from './spamPolicy'

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
	/** Validator admission limits. Defaults are intentionally permissive. */
	spamPolicy?: Partial<BidSpamPolicy>
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

	// Active unsubscribe handles: one global auction REQ and one child
	// REQ per tracked auction coordinate.
	const unsubscribes: Array<() => void> = []
	const watchedAuctionUnsubscribes = new Map<string, () => void>()
	// Bounded, TTL'd buffers for events that arrived before we knew
	// about their parent. Each entry carries the validator's
	// first-observed time so replay uses the original sighting, not
	// replay-time now() (which would let relay ordering change
	// prompt/late classification).
	//
	// The keys come straight off the relay, so they are attacker-chosen:
	// a bidder signing bids against invented auction ids must not be
	// able to grow one of these maps without limit, and a key whose
	// parent never arrives must not be pinned for the process lifetime
	// (review 5645059400 findings 1 and 3).
	const pendingLimits = resolvePendingBufferLimits(deps.spamPolicy)
	const pendingBids = createPendingBuffer<{ raw: NostrEvent; observedAt: number }>(pendingLimits) // auctionRootEventId → events
	const pendingReleases = new Map<string, { raw: NostrEvent; observedAt: number }[]>() // bidEventId → events
	const pendingSettlements = new Map<string, { raw: NostrEvent; observedAt: number }[]>() // auctionRootEventId → events
	const activeBidClaimsNeedingChildWatch = new Set([
		'valid_bid_placed',
		'bid_pending_review',
		'won_pending_settlement',
		'griefed_pending_fallback',
	])

	type RelayFilter = { kinds?: number[]; since?: number; '#a'?: string[] }

	const hasAttributablePendingChildren = (auctionRootEventId: string): boolean => {
		if (pendingBids.keys(now()).includes(auctionRootEventId)) return true
		if (pendingSettlements.has(auctionRootEventId)) return true
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return false
		for (const bidEventId of Array.from(auctionState.bids.keys())) {
			if (pendingReleases.has(bidEventId)) return true
		}
		return false
	}

	const auctionNeedsChildWatch = (auctionRootEventId: string): boolean => {
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return false
		if (hasAttributablePendingChildren(auctionRootEventId)) return true
		const childWindowClosesAt = auctionState.auction.maxEndAt + auctionState.auction.maxSkewSec
		if (now() <= childWindowClosesAt) return true
		for (const bidState of Array.from(auctionState.bids.values())) {
			if (bidState.currentClaim === null) return true
			if (activeBidClaimsNeedingChildWatch.has(bidState.currentClaim)) return true
		}
		return false
	}

	const stopWatchingAuction = (auctionRootEventId: string): void => {
		const unsubscribe = watchedAuctionUnsubscribes.get(auctionRootEventId)
		if (!unsubscribe) return
		watchedAuctionUnsubscribes.delete(auctionRootEventId)
		try {
			unsubscribe()
		} catch {
			// Ignore — pool might already be torn down.
		}
	}

	const maybeRetireAuctionWatch = (auctionRootEventId: string): void => {
		if (auctionNeedsChildWatch(auctionRootEventId)) return
		stopWatchingAuction(auctionRootEventId)
		logger.info(`[validator] closed child subscriptions for auction ${auctionRootEventId.slice(0, 8)}`)
	}

	const startWatchingAuction = async (auctionRootEventId: string): Promise<void> => {
		if (watchedAuctionUnsubscribes.has(auctionRootEventId)) return
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return
		const filters: RelayFilter[] = [
			{ kinds: [bidKindAsNumber(), pathReleaseKindAsNumber(), settlementKindAsNumber()], '#a': [auctionState.auction.coordinate] },
		]
		const unsubscribe = await deps.relayPool.subscribe(filters, (event) => {
			switch (event.kind) {
				case AUCTION_BID_KIND:
					void onBidEvent(event)
					return
				case AUCTION_PATH_RELEASE_KIND:
					void onPathReleaseEvent(event)
					return
				case AUCTION_SETTLEMENT_KIND:
					void onSettlementEvent(event)
					return
				default:
					return
			}
		})
		watchedAuctionUnsubscribes.set(auctionRootEventId, unsubscribe)
	}

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

	/**
	 * Envelope gate for every relay-fed event kind. `checkEventEnvelope`
	 * is kind-agnostic (serialized size + tag count), so it is the cheap
	 * first refusal on all four ingestion paths before parsing or
	 * buffering — the kind-1023 admission policy below only ever
	 * protected one of them (review 5645059400 finding 3).
	 */
	const passesEventEnvelope = (raw: NostrEvent, label: string): boolean => {
		const decision = checkEventEnvelope(raw, deps.spamPolicy)
		if (decision.ok) return true
		logger.warn(`[validator] dropping ${label} ${raw.id.slice(0, 8)}: ${decision.reason}`)
		return false
	}

	const onAuctionEvent = async (raw: NostrEvent): Promise<void> => {
		// Envelope first: the size/shape bound must bound the WORK, not
		// just the admission (review 5645059400 finding 4) — otherwise an
		// oversized event still pays getEventHash + schnorr.verify before
		// being dropped.
		if (!passesEventEnvelope(raw, 'auction')) {
			return
		}
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
			await startWatchingAuction(auction.rootEventId)
		}
		if (shouldDrain) {
			// Drain anything we'd buffered for this auction.
			await drainPending(auction.rootEventId)
		}
		maybeRetireAuctionWatch(auction.rootEventId)
	}

	const onBidEvent = async (raw: NostrEvent, observedAt?: number): Promise<void> => {
		// Envelope first: the size/shape bound must bound the WORK, not
		// just the admission (review 5645059400 finding 4) — otherwise an
		// oversized event still pays getEventHash + schnorr.verify before
		// being dropped.
		if (!passesEventEnvelope(raw, 'bid')) {
			return
		}
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
			const admission = pendingBids.add(bid.auctionRootEventId, { raw, observedAt: firstObservedAt }, now())
			if (admission !== 'buffered') {
				logger.warn(`[validator] dropping bid ${bid.id.slice(0, 8)}: pending buffer ${admission}`)
			}
			return
		}

		const auctionState = deps.state.auctions.get(bid.auctionRootEventId)
		if (!auctionState) return
		// LIFETIME count, by design (review 5645059400 finding 2): `bids` is
		// append-only and retains bids the verdict pass later marks invalid, so
		// this is a lifetime cap per (auction, bidder), NOT a count of open bids.
		// Documented rather than derived: the stored bid state carries verdict
		// reasons (currentClaim/currentReason), not an authoritative
		// active/invalid flag, so computing "active" here would invent protocol
		// semantics this boundary does not own. The policy limit is labelled
		// lifetime in spamPolicy.ts.
		const lifetimeBidCount = Array.from(auctionState.bids.values()).filter(
			(existingBid) => existingBid.bid.bidderPubkey.toLowerCase() === bid.bidderPubkey.toLowerCase(),
		).length
		const spamDecision = checkBidSpamPolicy({
			auction: auctionState.auction,
			bid,
			now: firstObservedAt,
			state: deps.state.spam,
			policy: deps.spamPolicy,
			activeBidCount: lifetimeBidCount,
		})
		if (!spamDecision.ok) {
			logger.warn(`[validator] dropping bid ${bid.id.slice(0, 8)}: ${spamDecision.reason}`)
			return
		}

		const result = upsertBid(deps.state, bid, firstObservedAt)
		if (!result) return // can't happen — auction is known per the check above
		recordAcceptedBid({ auction: auctionState.auction, bid, now: firstObservedAt, state: deps.state.spam, policy: deps.spamPolicy })

		// Run derive + publish.
		try {
			await deps.publisher.publishIfChanged({
				auctionState: result.auctionState,
				bidState: result.bidState,
			})
		} catch (err) {
			logger.error(`[validator] verdict publish failed for bid ${bid.id.slice(0, 8)}:`, err instanceof Error ? err.message : err)
		}
		maybeRetireAuctionWatch(bid.auctionRootEventId)
	}

	const onPathReleaseEvent = async (raw: NostrEvent, observedAt?: number): Promise<void> => {
		// Envelope first: the size/shape bound must bound the WORK, not
		// just the admission (review 5645059400 finding 4) — otherwise an
		// oversized event still pays getEventHash + schnorr.verify before
		// being dropped.
		if (!passesEventEnvelope(raw, 'path release')) {
			return
		}
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
			})
		} catch (err) {
			logger.error(
				`[validator] verdict publish failed after kind-1025 for bid ${release.bidEventId.slice(0, 8)}:`,
				err instanceof Error ? err.message : err,
			)
		}
		maybeRetireAuctionWatch(auctionState.auction.rootEventId)
	}

	const onSettlementEvent = async (raw: NostrEvent, observedAt?: number): Promise<void> => {
		// Envelope first: the size/shape bound must bound the WORK, not
		// just the admission (review 5645059400 finding 4) — otherwise an
		// oversized event still pays getEventHash + schnorr.verify before
		// being dropped.
		if (!passesEventEnvelope(raw, 'settlement')) {
			return
		}
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
		maybeRetireAuctionWatch(auctionState.auction.rootEventId)
	}

	// =========================================================================
	// Pending-event replay
	// =========================================================================

	const drainPending = async (auctionRootEventId: string): Promise<void> => {
		const bids = pendingBids.take(auctionRootEventId, now())
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
		for (const bidState of Array.from(auctionState.bids.values())) {
			try {
				await deps.publisher.publishIfChanged({
					auctionState,
					bidState,
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
		const since = now() - 60 * 60 * 24 * 30
		const auctionUnsub = await deps.relayPool.subscribe([{ kinds: [auctionKindAsNumber()], since }], (event) => {
			void onAuctionEvent(event)
		})
		unsubscribes.push(auctionUnsub)
		for (const auctionState of Array.from(deps.state.auctions.values())) {
			await startWatchingAuction(auctionState.auction.rootEventId)
		}

		logger.info('[validator] subscriptions established')
	}

	const stop = async (): Promise<void> => {
		for (const auctionRootEventId of Array.from(watchedAuctionUnsubscribes.keys())) {
			stopWatchingAuction(auctionRootEventId)
		}
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
			maybeRetireAuctionWatch(auctionState.auction.rootEventId)
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
