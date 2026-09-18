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
 *   2. kinds 1023/1025/1024 startup replay: one bounded historical REQ
 *      at process start, used only to preserve stable first-observation
 *      timestamps for child events that were already on the relay before
 *      their auction is discovered.
 *   3. kinds 1023/1025/1024 (bids, path releases, settlements): one
 *      REQ per tracked auction, scoped by `#a` to that auction's
 *      canonical coordinate (`30408:<seller>:<d>`). `#e` cannot serve
 *      as the shared child filter here: bids + settlements tag the
 *      auction root in `e`, but kind-1025 path releases tag the BID id
 *      there. All three child kinds do share the auction coordinate in
 *      `a`, so that is the narrow common live filter.
 *
 * Child REQs stay open until the auction is past the validator's own
 * observation window (see below) AND their historical replay has
 * completed AND the tracked bids are terminal AND no buffered children
 * attributable to that auction remain. We enforce closure by calling the
 * unsubscribe handle, not by `until`, so the validator never drops a
 * still-replayable child solely because its local clock advanced.
 *
 * ## Who owns the child-observation window
 *
 * The ingestion layer owns how long a closed auction's children are still
 * observed, and states the bound it applies. `auctionNeedsChildWatch`
 * keeps a child REQ open through the auction's own settlement window
 *
 *     max_end_at + max(max_skew_sec, settlement_grace)
 *
 * (locktime is `max_end_at + settlement_grace`, AUCTIONS.md §4.1; the skew
 * term is the validator's arrival allowance) — and past it for a further
 *
 *     late_settlement_observation_sec
 *
 * but only while some tracked bid still holds a claim that a late release
 * could change. `griefed` is one of those claims: AUCTIONS.md §8.4 keeps
 * `settled_late` reachable for a release published after
 * `settlement_grace` — and after locktime, as long as the bidder has not
 * refunded — and `lifecycle.ts` re-derives it whenever a release exists,
 * so the verdict layer deliberately outlives the settlement window. Both
 * layers now agree on one owner: the watch outlives the settlement window
 * by the published bound, and past that bound the validator does not
 * observe the release at all — the auction's terminal verdict stands
 * instead of the late-release path being supported in one layer and
 * unreachable through the other (review 5242945675 Required 1).
 *
 * **Fan-out consequence.** One REQ per tracked auction, capped by
 * `maxTrackedChildSubscriptions` (512). Extending the window by
 * `late_settlement_observation_sec` keeps every auction inside that cap
 * for longer, so at sustained volume the cap can be reached and a further
 * auction's children are then *not observed at all* — fail-closed, warned
 * here, and stated in the published policy `notes`. An operator trading
 * observation completeness for fan-out headroom lowers
 * `late_settlement_observation_sec`; an operator raising it raises
 * `maxTrackedChildSubscriptions` with it.
 *
 * ## `observed_at` precedence for child events
 *
 * A child event reaches a handler from one of three places, and the
 * distinction decides the `observed_at` the verdict carries
 * (AUCTIONS.md §4.4.1):
 *
 *   1. `buffered` — this process saw it live and held it until its parent
 *      arrived. The recorded sighting is authoritative and wins.
 *   2. `startup-replay` — the relay delivered it as history at process
 *      start. It carries no sighting of its own, so the first-observation
 *      recovered from this validator's own prior verdicts
 *      (`observedAtRecovery.ts`, Fix 1) wins when there is one; the
 *      replay's placeholder clock is used only when there is not.
 *   3. `live` — no explicit stamp: recovered seed, else `now()`.
 *
 * The placeholder clock is process start, and it is only ever used while
 * the replay REQ is open. That REQ is bounded: it closes on EOSE **or**
 * after `childReplayCompletionTimeoutSec`, whichever fires first, because
 * `@contextvm/sdk` surfaces only the relay's own EOSE and this repo
 * documents relays that never send it (`src/lib/nostr/io.ts`,
 * `observedAtRecovery.ts`). Without the timeout a missing EOSE stamped
 * every child event for the process lifetime with the process-start clock
 * — a false-condemnation source, not "replay still running" (review
 * 5242945675 Required 2).
 *
 * ## Refusals are log-only
 *
 * Every refusal on this boundary — envelope, spam policy, pending-buffer
 * admission, child-subscription auction mismatch — is a `logger.warn`
 * followed by `return`. Nothing is published to a relay, so a refused bid
 * is indistinguishable from an unobserved one: this boundary carries no
 * refusal reason back to the bidder (review 5242945675 Required 4). The
 * reason codes that would describe a refusal are marked forward-declared
 * in `constants.ts`, and the published kind-30441 policy states the same
 * thing in its `notes`, so a consumer cannot build against a vocabulary
 * nothing produces.
 */

import type { ApplesauceRelayPool } from '@contextvm/sdk'
import { schnorr } from '@noble/curves/secp256k1.js'
import type { NostrEvent } from 'nostr-tools'
import { getEventHash } from 'nostr-tools'
import { AUCTION_BID_KIND, AUCTION_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '../../lib/auction/constants'
import { parseAuctionEvent } from '../../lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '../../lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '../../lib/schemas/auction/settlementEvents'

import { acceptedBidCountForBidder, recordPathRelease, recordSettlement, upsertAuction, upsertBid, type ValidatorState } from './state'
import { createPendingBuffer, createPendingBufferBudget } from './pendingBuffer'
import { refreshAuctionMintReachability, type MintProbePolicy } from './mintReachability'
import type { createVerdictPublisher } from './publisher'
import type { Nut7Poller } from './nut7Poller'
import {
	checkBidSpamPolicy,
	checkEventEnvelope,
	recordAcceptedBid,
	resolveBidSpamPolicy,
	resolvePendingBufferLimits,
	type BidSpamPolicy,
} from './spamPolicy'

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

/**
 * Where a child event came from, which decides the `observed_at` its
 * verdict carries. See the module docstring — `startup-replay` carries no
 * sighting of its own, so a recovered seed outranks its placeholder clock.
 */
type ChildObservation = { source: 'live' } | { source: 'buffered'; observedAt: number } | { source: 'startup-replay'; observedAt: number }

/**
 * One tracked auction's child REQ, plus the bookkeeping that keeps the
 * REQ alive until its historical replay is finished.
 */
interface WatchedAuctionChildReq {
	unsubscribe: () => void
	/**
	 * True once the replay is complete (EOSE) or has been given up on
	 * (bounded timeout). Retirement waits for this.
	 */
	replayComplete: boolean
	/** Clears the bounded-replay timer. Idempotent. */
	cancelReplayTimer: () => void
}

export const createValidatorSubscriber = (deps: ValidatorSubscriberDeps): ValidatorSubscriber => {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
	const logger = deps.logger ?? defaultLogger()
	const resolvedPolicy = resolveBidSpamPolicy(deps.spamPolicy)

	// Active unsubscribe handles: one global auction REQ and one child
	// REQ per tracked auction coordinate.
	const unsubscribes: Array<() => void> = []
	const watchedAuctionUnsubscribes = new Map<string, WatchedAuctionChildReq>()
	// Bounded, TTL'd buffers for events that arrived before we knew
	// about their parent. Each entry carries the validator's
	// first-observed time so replay uses the original sighting, not
	// replay-time now() (which would let relay ordering change
	// prompt/late classification).
	//
	// The keys come straight off the relay, so they are attacker-chosen:
	// a bidder signing bids against invented auction ids must not be
	// able to grow one of these buffers without limit, and a key whose
	// parent never arrives must not be pinned for the process lifetime
	// (review 5645059400 findings 1 and 3). Eviction is fail-closed: a
	// dropped buffered event is never replayed, so no verdict is emitted.
	// The three buffers share one aggregate event budget, so the worst
	// case is bounded across the combined ordering-gap surface.
	const pendingLimits = resolvePendingBufferLimits(resolvedPolicy)
	const pendingBudget = createPendingBufferBudget(pendingLimits.maxPendingEvents)
	const pendingBids = createPendingBuffer<{ raw: NostrEvent; observedAt: number }>(pendingLimits, pendingBudget) // auctionRootEventId → events
	const pendingReleases = createPendingBuffer<{ raw: NostrEvent; observedAt: number }>(pendingLimits, pendingBudget) // bidEventId → events
	const pendingSettlements = createPendingBuffer<{ raw: NostrEvent; observedAt: number }>(pendingLimits, pendingBudget) // auctionRootEventId → events
	const activeBidClaimsNeedingChildWatch = new Set([
		'valid_bid_placed',
		'bid_pending_review',
		'won_pending_settlement',
		'griefed_pending_fallback',
		// `griefed` is terminal but NOT immovable: `deriveVerdict` is a pure
		// function of state + now, so a kind-1025 that arrives after the
		// grace window re-derives the winner as `settled_late` (AUCTIONS.md
		// §8.4) and the publisher's diff emits it. Leaving it out of this
		// set was the half of Required 1 that made the late-release path
		// unit-tested in `lifecycle.ts` and unreachable through ingestion
		// (review 5242945675 Required 1).
		'griefed',
	])

	type RelayFilter = { kinds?: number[]; since?: number; '#a'?: string[] }

	/**
	 * Precomputed key sets for one decision pass. Each `keys()` call
	 * sweeps TTLs and allocates an array, and the retire/reconcile path
	 * asks the same three questions per tracked auction — so the snapshot
	 * is taken once per pass instead of once per question (review
	 * 5242945675, non-blocking).
	 */
	interface PendingKeySnapshot {
		bidAuctionKeys: Set<string>
		settlementAuctionKeys: Set<string>
		releaseBidKeys: Set<string>
	}

	const snapshotPendingKeys = (): PendingKeySnapshot => ({
		bidAuctionKeys: new Set(pendingBids.keys(now())),
		settlementAuctionKeys: new Set(pendingSettlements.keys(now())),
		releaseBidKeys: new Set(pendingReleases.keys(now())),
	})

	const hasAttributablePendingChildren = (auctionRootEventId: string, snapshot: PendingKeySnapshot): boolean => {
		if (snapshot.bidAuctionKeys.has(auctionRootEventId)) return true
		if (snapshot.settlementAuctionKeys.has(auctionRootEventId)) return true
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return false
		for (const bidEventId of Array.from(auctionState.bids.keys())) {
			if (snapshot.releaseBidKeys.has(bidEventId)) return true
		}
		return false
	}

	const auctionNeedsChildWatch = (auctionRootEventId: string, snapshot: PendingKeySnapshot): boolean => {
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return false
		if (hasAttributablePendingChildren(auctionRootEventId, snapshot)) return true
		// The observation window this layer owns: the auction's own
		// settlement window, plus — only while some bid still has a verdict
		// a late release could change — the declared arrival bound for a
		// voluntary late release. See the module docstring.
		const settlementWindowClosesAt =
			auctionState.auction.maxEndAt + Math.max(auctionState.auction.maxSkewSec, auctionState.auction.settlementGrace)
		if (now() <= settlementWindowClosesAt) return true
		if (now() > settlementWindowClosesAt + resolvedPolicy.lateSettlementObservationSec) return false
		for (const bidState of Array.from(auctionState.bids.values())) {
			if (bidState.currentClaim === null) return true
			if (activeBidClaimsNeedingChildWatch.has(bidState.currentClaim)) return true
		}
		return false
	}

	const stopWatchingAuction = (auctionRootEventId: string): void => {
		const watched = watchedAuctionUnsubscribes.get(auctionRootEventId)
		if (!watched) return
		watchedAuctionUnsubscribes.delete(auctionRootEventId)
		watched.cancelReplayTimer()
		try {
			watched.unsubscribe()
		} catch {
			// Ignore — pool might already be torn down.
		}
	}

	/**
	 * Retire a child REQ when nothing is left to watch. Returns whether
	 * the watch was actually retired, so callers can reconcile only when
	 * the fan-out budget changed (review 5242945675, non-blocking).
	 *
	 * A watch is never retired before its historical replay is known to be
	 * complete or has been given up on: an auction discovered for the
	 * first time after its window closed would otherwise open and retire
	 * its REQ in one tick, before the replay could deliver the children
	 * that decide its verdict (review 5242945675 Required 2).
	 */
	const maybeRetireAuctionWatch = (auctionRootEventId: string): boolean => {
		const watched = watchedAuctionUnsubscribes.get(auctionRootEventId)
		if (!watched) return false
		if (!watched.replayComplete) return false
		if (auctionNeedsChildWatch(auctionRootEventId, snapshotPendingKeys())) return false
		stopWatchingAuction(auctionRootEventId)
		logger.info(`[validator] closed child subscriptions for auction ${auctionRootEventId.slice(0, 8)}`)
		return true
	}

	const childReplaySince = (auctionStartedAt?: number): number => {
		const lookbackFloor = now() - resolvedPolicy.childReplayLookbackSec
		if (auctionStartedAt === undefined) return lookbackFloor
		return Math.max(lookbackFloor, auctionStartedAt)
	}

	const reconcileAuctionWatches = async (): Promise<void> => {
		const snapshot = snapshotPendingKeys()
		for (const auctionState of Array.from(deps.state.auctions.values())) {
			if (watchedAuctionUnsubscribes.size >= resolvedPolicy.maxTrackedChildSubscriptions) return
			if (watchedAuctionUnsubscribes.has(auctionState.auction.rootEventId)) continue
			if (!auctionNeedsChildWatch(auctionState.auction.rootEventId, snapshot)) continue
			await startWatchingAuction(auctionState.auction.rootEventId)
		}
	}

	const drainPendingReleasesForBid = async (auctionRootEventId: string, bidEventId: string): Promise<void> => {
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState || !auctionState.bids.has(bidEventId)) return
		const releases = pendingReleases.take(bidEventId, now())
		for (const { raw, observedAt } of releases) await onPathReleaseEvent(raw, { source: 'buffered', observedAt })
	}

	/**
	 * `observed_at` for a bid. A buffered sighting is authoritative; a
	 * startup-replay delivery is a placeholder that yields to the
	 * recovered first observation; a live delivery uses the recovered
	 * seed when the validator has seen this bid before (Fix 1) and
	 * `now()` otherwise.
	 */
	const bidFirstObservedAt = (bidEventId: string, observation: ChildObservation): number => {
		if (observation.source === 'buffered') return observation.observedAt
		const recovered = deps.seedObservedAt?.get(bidEventId)
		if (recovered !== undefined) return recovered
		return observation.source === 'startup-replay' ? observation.observedAt : now()
	}

	/**
	 * `observed_at` for a path release or settlement. The recovered seed
	 * is keyed by bid event id and records when the validator first saw
	 * the BID — it says nothing about when this release was first seen, so
	 * it is deliberately not consulted here.
	 */
	const childFirstObservedAt = (observation: ChildObservation): number => (observation.source === 'live' ? now() : observation.observedAt)

	const dispatchChildEvent = (event: NostrEvent, observation: ChildObservation): void => {
		switch (event.kind) {
			case AUCTION_BID_KIND:
				void onBidEvent(event, observation)
				return
			case AUCTION_PATH_RELEASE_KIND:
				void onPathReleaseEvent(event, observation)
				return
			case AUCTION_SETTLEMENT_KIND:
				void onSettlementEvent(event, observation)
				return
			default:
				return
		}
	}

	const startWatchingAuction = async (auctionRootEventId: string): Promise<void> => {
		if (watchedAuctionUnsubscribes.has(auctionRootEventId)) return
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return
		if (watchedAuctionUnsubscribes.size >= resolvedPolicy.maxTrackedChildSubscriptions) {
			logger.warn(`[validator] child subscription cap reached for auction ${auctionRootEventId.slice(0, 8)}`)
			return
		}
		const watchedCoordinate = auctionState.auction.coordinate
		const replayTimeoutMs = resolvedPolicy.childReplayCompletionTimeoutSec * 1000
		const filters: RelayFilter[] = [
			{
				kinds: [bidKindAsNumber(), pathReleaseKindAsNumber(), settlementKindAsNumber()],
				'#a': [watchedCoordinate],
				since: childReplaySince(auctionState.auction.startAt),
			},
		]
		let replayComplete = false
		let replayTimer: ReturnType<typeof setTimeout> | null = null
		const clearReplayTimer = (): void => {
			if (replayTimer) {
				clearTimeout(replayTimer)
				replayTimer = null
			}
		}
		const completeReplay = (reason: 'eose' | 'timeout'): void => {
			if (replayComplete) return
			replayComplete = true
			clearReplayTimer()
			const watched = watchedAuctionUnsubscribes.get(auctionRootEventId)
			if (watched) watched.replayComplete = true
			if (reason === 'timeout') {
				logger.warn(
					`[validator] child replay for auction ${auctionRootEventId.slice(0, 8)} did not reach EOSE within ${resolvedPolicy.childReplayCompletionTimeoutSec}s — releasing it; children the replay had not delivered are not observed`,
				)
			}
			// The replay was the only thing holding this watch open for an
			// auction whose window has already closed.
			if (maybeRetireAuctionWatch(auctionRootEventId)) void reconcileAuctionWatches()
		}
		const unsubscribe = await deps.relayPool.subscribe(
			filters,
			(event) => {
				switch (event.kind) {
					case AUCTION_BID_KIND: {
						const parsed = parseBidEvent(event)
						if (
							parsed.ok &&
							(parsed.value.auctionRootEventId !== auctionRootEventId || parsed.value.auctionCoordinate !== watchedCoordinate)
						) {
							logger.warn(`[validator] dropping bid ${parsed.value.id.slice(0, 8)}: child subscription auction mismatch`)
							return
						}
						break
					}
					case AUCTION_PATH_RELEASE_KIND: {
						const parsed = parsePathReleaseEvent(event)
						if (parsed.ok && parsed.value.auctionCoordinate !== watchedCoordinate) {
							logger.warn(`[validator] dropping kind-1025 ${parsed.value.id.slice(0, 8)}: child subscription auction mismatch`)
							return
						}
						break
					}
					case AUCTION_SETTLEMENT_KIND: {
						const parsed = parseSettlementEvent(event)
						if (
							parsed.ok &&
							(parsed.value.auctionRootEventId !== auctionRootEventId || parsed.value.auctionCoordinate !== watchedCoordinate)
						) {
							logger.warn(`[validator] dropping kind-1024 ${parsed.value.id.slice(0, 8)}: child subscription auction mismatch`)
							return
						}
						break
					}
					default:
						break
				}
				dispatchChildEvent(event, { source: 'live' })
			},
			// EOSE — the relay has finished replaying this auction's history.
			() => completeReplay('eose'),
		)
		watchedAuctionUnsubscribes.set(auctionRootEventId, {
			unsubscribe,
			replayComplete,
			cancelReplayTimer: clearReplayTimer,
		})
		if (replayComplete) {
			// EOSE arrived before the handle was registered — a pool may answer
			// synchronously. The completion work still has to run, now that
			// there is a record to mark. The REQ itself stays open: EOSE ends
			// the replay, not the live watch.
			if (maybeRetireAuctionWatch(auctionRootEventId)) void reconcileAuctionWatches()
		} else {
			// Bounded lifetime: EOSE is the only completion signal the pool
			// surfaces, and this repo documents relays that never send it.
			replayTimer = setTimeout(() => completeReplay('timeout'), replayTimeoutMs)
		}
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
		// Resolved policy, like every other gate on this boundary — not the
		// raw partial the caller passed in (review 5242945675, non-blocking).
		const decision = checkEventEnvelope(raw, resolvedPolicy)
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
		}
		if (shouldDrain) {
			// Drain anything we'd buffered for this auction.
			await drainPending(auction.rootEventId)
			await startWatchingAuction(auction.rootEventId)
			// The scoped REQ may replay release-before-bid history for this
			// auction; drain again so those freshly buffered children resolve.
			await drainPending(auction.rootEventId)
		}
		// A newly tracked auction may want a watch of its own, so reconcile
		// here is unconditional.
		await reconcileAuctionWatches()
	}

	const onBidEvent = async (raw: NostrEvent, observation: ChildObservation): Promise<void> => {
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
		// A buffered sighting wins; otherwise the recovered seed
		// (cross-restart first-observation, Fix 1) outranks a startup
		// replay's placeholder clock, which in turn outranks nothing.
		// See the module docstring for why the replay stamp yields to the
		// seed instead of shadowing it.
		const firstObservedAt = bidFirstObservedAt(bid.id, observation)

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
		// lifetime in spamPolicy.ts. Read from the incremental per-bidder
		// tally `upsertBid` maintains, so this is O(1) instead of a full
		// scan of `bids` on every accepted bid (review 5242945675,
		// non-blocking); the tally and the map stay in step because both
		// only ever grow on insert.
		const lifetimeBidCount = acceptedBidCountForBidder(auctionState, bid.bidderPubkey)
		const spamDecision = checkBidSpamPolicy({
			auction: auctionState.auction,
			bid,
			now: firstObservedAt,
			state: deps.state.spam,
			policy: resolvedPolicy,
			trackedBidCount: lifetimeBidCount,
		})
		if (!spamDecision.ok) {
			logger.warn(`[validator] dropping bid ${bid.id.slice(0, 8)}: ${spamDecision.reason}`)
			return
		}

		const result = upsertBid(deps.state, bid, firstObservedAt)
		if (!result) return // can't happen — auction is known per the check above
		recordAcceptedBid({ auction: auctionState.auction, bid, now: firstObservedAt, state: deps.state.spam, policy: resolvedPolicy })
		await drainPendingReleasesForBid(bid.auctionRootEventId, bid.id)

		// Run derive + publish.
		try {
			await deps.publisher.publishIfChanged({
				auctionState: result.auctionState,
				bidState: result.bidState,
			})
		} catch (err) {
			logger.error(`[validator] verdict publish failed for bid ${bid.id.slice(0, 8)}:`, err instanceof Error ? err.message : err)
		}
		// Only a retirement frees fan-out budget, so only a retirement
		// needs the reconcile sweep (review 5242945675, non-blocking).
		if (maybeRetireAuctionWatch(bid.auctionRootEventId)) await reconcileAuctionWatches()
	}

	const onPathReleaseEvent = async (raw: NostrEvent, observation: ChildObservation): Promise<void> => {
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
		const firstObservedAt = childFirstObservedAt(observation)

		const recordResult = recordPathRelease(deps.state, release, firstObservedAt)
		if (recordResult.status === 'unknown_bid') {
			// We don't know about this bid yet (auction or bid event
			// hasn't arrived). Stash and replay when the bid appears;
			// authorization is re-applied on replay. Preserve the
			// first-observed time so prompt/late classification is stable.
			const admission = pendingReleases.add(release.bidEventId, { raw, observedAt: firstObservedAt }, now())
			if (admission !== 'buffered') {
				logger.warn(`[validator] dropping kind-1025 ${release.id.slice(0, 8)}: pending buffer ${admission}`)
			}
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
		if (maybeRetireAuctionWatch(auctionState.auction.rootEventId)) await reconcileAuctionWatches()
	}

	const onSettlementEvent = async (raw: NostrEvent, observation: ChildObservation): Promise<void> => {
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
		const firstObservedAt = childFirstObservedAt(observation)

		const recordResult = recordSettlement(deps.state, settlement)
		if (recordResult.status === 'unknown_auction') {
			const admission = pendingSettlements.add(settlement.auctionRootEventId, { raw, observedAt: firstObservedAt }, now())
			if (admission !== 'buffered') {
				logger.warn(`[validator] dropping kind-1024 ${settlement.id.slice(0, 8)}: pending buffer ${admission}`)
			}
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
		if (maybeRetireAuctionWatch(auctionState.auction.rootEventId)) await reconcileAuctionWatches()
	}

	// =========================================================================
	// Pending-event replay
	// =========================================================================

	const drainPending = async (auctionRootEventId: string): Promise<void> => {
		const bids = pendingBids.take(auctionRootEventId, now())
		for (const { raw, observedAt } of bids) await onBidEvent(raw, { source: 'buffered', observedAt })

		const settlements = pendingSettlements.take(auctionRootEventId, now())
		for (const { raw, observedAt } of settlements) await onSettlementEvent(raw, { source: 'buffered', observedAt })

		// Path releases are keyed by bidEventId — after the bids
		// drained above, try replaying every stash and clean up the
		// ones that now resolve.
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return
		for (const bidEventId of pendingReleases.keys(now())) {
			if (!auctionState.bids.has(bidEventId)) continue
			await drainPendingReleasesForBid(auctionRootEventId, bidEventId)
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
		const since = childReplaySince()
		const startupObservedAt = now()
		const startupReplayTimeoutMs = resolvedPolicy.childReplayCompletionTimeoutSec * 1000
		let startupChildReplayDone = false
		let startupChildReplayUnsub: (() => void) | null = null
		let startupChildReplayTimer: ReturnType<typeof setTimeout> | null = null
		const stopStartupChildReplay = (): void => {
			const off = startupChildReplayUnsub
			startupChildReplayUnsub = null
			if (startupChildReplayTimer) {
				clearTimeout(startupChildReplayTimer)
				startupChildReplayTimer = null
			}
			if (!off) return
			try {
				off()
			} catch {
				// Ignore — pool might already be torn down.
			}
		}
		// Bounded lifetime (review 5242945675 Required 2): EOSE is the only
		// completion signal the pool surfaces and a relay may never send it,
		// so a missing EOSE must not leave this REQ open — and every child
		// event it delivers stamped with the process-start clock — for the
		// process lifetime. History the replay has not delivered by the
		// deadline is still covered: each auction's own child REQ replays
		// its history when the auction is discovered.
		const finishStartupChildReplay = (reason: 'eose' | 'timeout'): void => {
			if (startupChildReplayDone) return
			startupChildReplayDone = true
			if (reason === 'timeout') {
				logger.warn(
					`[validator] startup child replay did not reach EOSE within ${resolvedPolicy.childReplayCompletionTimeoutSec}s — closing it; history it had not delivered is replayed per-auction on discovery`,
				)
			}
			stopStartupChildReplay()
		}
		startupChildReplayUnsub = await deps.relayPool.subscribe(
			[{ kinds: [bidKindAsNumber(), pathReleaseKindAsNumber(), settlementKindAsNumber()], since }],
			(event) => {
				dispatchChildEvent(event, { source: 'startup-replay', observedAt: startupObservedAt })
			},
			() => finishStartupChildReplay('eose'),
		)
		if (startupChildReplayDone) {
			stopStartupChildReplay()
		} else {
			unsubscribes.push(stopStartupChildReplay)
			startupChildReplayTimer = setTimeout(() => finishStartupChildReplay('timeout'), startupReplayTimeoutMs)
		}
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
		await reconcileAuctionWatches()
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
