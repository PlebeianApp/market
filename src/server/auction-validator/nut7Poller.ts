/**
 * NUT-7 poller — the validator's mint-state watchdog.
 *
 * Every tick (default 30s) we:
 *   1. Collect all live bids across all tracked auctions
 *      (`state.collectLiveBids`).
 *   2. Bucket their `proof_y` values by mint URL.
 *   3. Send one batched NUT-7 query per mint (cashu-ts `mint.check`).
 *   4. Update each affected `ValidatorBidState.nut7States`.
 *   5. For bids whose aggregate state changed, ask the publisher to
 *      re-derive + republish the verdict.
 *
 * Why bucket by mint: cashu-ts's check endpoint takes a flat
 * `Ys: string[]` array per mint; batching across all our tracked bids
 * for that mint cuts round-trips.
 *
 * Why suppress on no-change: NUT-7 state is stable across many ticks
 * for typical bids; we'd otherwise flood relays with identical
 * kind-30440 events. The publisher already gates on verdictChanged,
 * but skipping the per-bid loop entirely when no proof state moved
 * saves CPU on the validator side too.
 */

import { checkProofStateBatch, type CheckProofStateOptions } from '../../lib/cashu/nut7'
import { checkMintProbeDestination, createPolicyEnforcedRequest } from './mintDestination'
import {
	aggregateProofStates,
	collectLiveBids,
	isTerminalClaim,
	recordNut7State,
	MAX_REPLACEMENT_CHAIN_DEPTH,
	type ValidatorAuctionState,
	type ValidatorBidState,
	type ValidatorState,
} from './state'
import { currentTopValidBidAmount } from './lifecycle'
import { refreshAuctionMintReachability, type MintProbePolicy } from './mintReachability'
import type { createVerdictPublisher } from './publisher'

// ---------------------------------------------------------------------------
// Bounded post-grace retry configuration
// ---------------------------------------------------------------------------

/**
 * Maximum number of post-grace proof polls for a single released
 * nonterminal bid before the poller gives up (explicit cutoff). A
 * voluntary_late release and its redemption happen after settlement
 * grace; without a cutoff the poller could chase a never-redeemed bid
 * forever.
 */
export const POST_GRACE_MAX_ATTEMPTS = 8

/**
 * Base backoff (seconds) between post-grace retries; doubled each
 * attempt and capped so retries space out but don't stall for too long.
 */
export const POST_GRACE_BASE_BACKOFF_SEC = 60
export const POST_GRACE_MAX_BACKOFF_SEC = 1_800

const postGraceBackoffSec = (attempt: number): number =>
	Math.min(POST_GRACE_BASE_BACKOFF_SEC * 2 ** (attempt - 1), POST_GRACE_MAX_BACKOFF_SEC)

export interface Nut7PollerDeps {
	state: ValidatorState
	publisher: ReturnType<typeof createVerdictPublisher>
	/** Per-mint NUT-7 query options (timeout etc.). Optional. */
	nut7Options?: CheckProofStateOptions
	/** Operator-controlled outbound-network + load policy for mint probes. */
	mintProbePolicy?: MintProbePolicy
	/** Override for "current time" — defaults to `Date.now() / 1000`. */
	now?: () => number
	/** Per-tick logger; defaults to console. */
	logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}

export interface Nut7Poller {
	/** Run one full poll round. Awaits all per-mint batches in parallel. */
	tick: () => Promise<void>
	/** Force-refresh NUT-7 states for one bid chain (used on kind-1025 arrival). */
	refreshBidChain: (input: { auctionRootEventId: string; bidEventId: string }) => Promise<void>
	/** Force-refresh NUT-7 states for released, nonterminal bids in an auction (used on kind-1024 arrival). */
	refreshAuctionReleasedNonterminal: (auctionRootEventId: string) => Promise<void>
}

export const createNut7Poller = (deps: Nut7PollerDeps): Nut7Poller => {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
	const logger = deps.logger ?? defaultLogger()

	const tick = async (): Promise<void> => {
		const observedAt = now()

		for (const auctionState of Array.from(deps.state.auctions.values())) {
			try {
				await refreshAuctionMintReachability(auctionState, deps.nut7Options, deps.mintProbePolicy)
			} catch (err) {
				logger.warn(
					`[validator-nut7] mint reachability refresh failed for auction ${auctionState.auction.rootEventId.slice(0, 8)}:`,
					err instanceof Error ? err.message : err,
				)
			}
		}

		const live = collectLiveBids(deps.state, observedAt)
		if (!live.length) return
		// Post-grace released nonterminal bids poll on a bounded backoff
		// schedule with an explicit cutoff (see POST_GRACE_* constants).
		// Pre-grace bids always poll.
		const due = live.filter(({ auctionState, bidState }) => {
			const postGrace = observedAt > auctionState.auction.maxEndAt + auctionState.auction.settlementGrace
			if (!postGrace) return true
			const retry = bidState.postGraceRetry
			if (!retry) return true
			if (retry.attempts >= POST_GRACE_MAX_ATTEMPTS) return false
			if (observedAt < retry.nextAttemptAt) return false
			return true
		})
		if (!due.length) return
		const entries = expandProofEntries(due)
		if (!entries.length) return

		await refreshProofStates(entries, observedAt, 'tick')
		schedulePostGraceRetries(due, observedAt)
	}

	const refreshBidChain = async (input: { auctionRootEventId: string; bidEventId: string }): Promise<void> => {
		const auctionState = deps.state.auctions.get(input.auctionRootEventId)
		if (!auctionState) return
		const bidState = auctionState.bids.get(input.bidEventId)
		if (!bidState) return

		const observedAt = now()
		const chain = buildBidChain(auctionState, bidState)
		const chainWithReleases = chain.filter((leg) => leg.bid.id === bidState.bid.id || auctionState.pathReleases.has(leg.bid.id))
		const entries = expandProofEntries(chainWithReleases.map((leg) => ({ auctionState, bidState: leg })))
		if (!entries.length) return

		await refreshProofStates(entries, observedAt, `refresh_bid_chain:${input.bidEventId.slice(0, 8)}`)
	}

	const refreshAuctionReleasedNonterminal = async (auctionRootEventId: string): Promise<void> => {
		const auctionState = deps.state.auctions.get(auctionRootEventId)
		if (!auctionState) return

		const observedAt = now()
		const released = Array.from(auctionState.bids.values()).filter(
			(bidState) => auctionState.pathReleases.has(bidState.bid.id) && !isTerminalClaim(bidState.currentClaim),
		)
		const entries = expandProofEntries(released.map((bidState) => ({ auctionState, bidState })))
		if (!entries.length) return

		await refreshProofStates(entries, observedAt, `refresh_released:${auctionRootEventId.slice(0, 8)}`)
	}

	const refreshProofStates = async (entries: ProofQueryEntry[], observedAt: number, source: string): Promise<void> => {
		if (!entries.length) return

		// Pre-flight: when no operator allowlist is configured, mint
		// probing is disabled — skip all NUT-7 calls and leave proof
		// states as `unknown`. When an allowlist is configured, only
		// mints on it are queried (in addition to passing the syntactic
		// destination check).
		const allowInsecureLocalhost = deps.mintProbePolicy?.allowInsecureLocalhost ?? false
		const allowedMints = deps.mintProbePolicy?.allowedMints

		// Policy-enforcing transport for the actual NUT-7 request boundary
		// (validates the mint URL against the allowlist + syntactic check,
		// and every redirect hop against the syntactic check, before
		// contact).
		const customRequest = createPolicyEnforcedRequest({ allowInsecureLocalhost, allowedMints })
		const nut7Opts: CheckProofStateOptions = { ...deps.nut7Options, customRequest }

		// Bucket Y → bid for each mint. The mint takes a flat
		// `Ys: string[]`, but we need to map results back to the
		// originating bid state when the response arrives.
		const buckets = new Map<string, MintBucket>()
		for (const entry of entries) {
			const mintUrl = entry.bidState.bid.mint
			// Pre-flight gate: skip mints not on the operator allowlist
			// (or all mints when probing is disabled). The transport
			// also enforces this, but filtering here avoids constructing
			// requests that will just throw.
			const dest = checkMintProbeDestination(mintUrl, { allowInsecureLocalhost, allowedMints })
			if (!dest.allowed) {
				logger.warn(`[validator-nut7] ${source} skipping mint ${mintUrl}: ${dest.reason}`)
				continue
			}
			let bucket = buckets.get(mintUrl)
			if (!bucket) {
				bucket = { mintUrl, entries: [] }
				buckets.set(mintUrl, bucket)
			}
			bucket.entries.push(entry)
		}
		if (buckets.size === 0) return

		// Run each mint's batch in parallel. Per-mint failures are
		// non-fatal — we just leave that bucket's bids' Y states as
		// `unknown` and let the next tick retry.
		await Promise.all(
			Array.from(buckets.values()).map(async (bucket) => {
				const allYs = bucket.entries.map((e) => e.proofY)
				let response: Map<string, ReturnType<typeof aggregateProofStates>> | null = null
				try {
					response = await checkProofStateBatch(bucket.mintUrl, allYs, nut7Opts)
				} catch (err) {
					logger.warn(`[validator-nut7] ${source} mint ${bucket.mintUrl} batch failed:`, err instanceof Error ? err.message : err)
					return
				}

				// Track which bids' aggregate state changed so we only
				// republish the affected ones.
				const dirtyBids = new Map<string, { auctionState: ValidatorAuctionState; bidState: ValidatorBidState }>()
				for (const entry of bucket.entries) {
					const key = entry.proofY.toLowerCase()
					const next = response!.get(key) ?? 'unknown'
					// Compare the STORED state before and after so a stale
					// write that recordNut7State ignores (older observedAt)
					// does not spuriously flag the bid dirty / republish.
					const before = entry.bidState.nut7States.get(key)?.state
					recordNut7State(entry.bidState, entry.proofY, next, observedAt)
					const after = entry.bidState.nut7States.get(key)?.state
					if (before !== after) dirtyBids.set(entry.bidState.bid.id, { auctionState: entry.auctionState, bidState: entry.bidState })
				}

				// Republish for the dirty bids only.
				for (const { auctionState, bidState } of Array.from(dirtyBids.values())) {
					try {
						await deps.publisher.publishIfChanged({
							auctionState,
							bidState,
							currentTopBid: currentTopValidBidAmount(auctionState),
						})
					} catch (err) {
						logger.error(
							`[validator-nut7] ${source} publish failed for bid ${bidState.bid.id.slice(0, 8)} (${auctionState.auction.dTag}):`,
							err instanceof Error ? err.message : err,
						)
					}
				}
			}),
		)
	}

	/**
	 * After a tick, advance the bounded post-grace retry schedule for each
	 * polled bid that is still released-and-nonterminal past grace. A bid
	 * that flipped terminal (settled) clears its schedule; one still
	 * non-terminal gets the next backoff slot, or hits the cutoff and stops.
	 */
	const schedulePostGraceRetries = (
		bids: Array<{ auctionState: ValidatorAuctionState; bidState: ValidatorBidState }>,
		observedAt: number,
	): void => {
		for (const { auctionState, bidState } of bids) {
			const postGrace = observedAt > auctionState.auction.maxEndAt + auctionState.auction.settlementGrace
			if (!postGrace) continue
			if (isTerminalClaim(bidState.currentClaim)) {
				bidState.postGraceRetry = null
				continue
			}
			// Only released nonterminal bids were collected post-grace.
			const attempts = (bidState.postGraceRetry?.attempts ?? 0) + 1
			if (attempts >= POST_GRACE_MAX_ATTEMPTS) {
				// Cutoff reached: leave the bid at its last verdict.
				bidState.postGraceRetry = { attempts, nextAttemptAt: Number.POSITIVE_INFINITY }
			} else {
				bidState.postGraceRetry = { attempts, nextAttemptAt: observedAt + postGraceBackoffSec(attempts) }
			}
		}
	}

	return { tick, refreshBidChain, refreshAuctionReleasedNonterminal }
}

// ============================================================================
// Internal types + helpers
// ============================================================================

interface MintBucket {
	mintUrl: string
	entries: ProofQueryEntry[]
}

interface ProofQueryEntry {
	auctionState: ValidatorAuctionState
	bidState: ValidatorBidState
	proofY: string
}

const expandProofEntries = (
	bids: Array<{
		auctionState: ValidatorAuctionState
		bidState: ValidatorBidState
	}>,
): ProofQueryEntry[] => {
	const out: ProofQueryEntry[] = []
	for (const { auctionState, bidState } of bids) {
		for (const proofY of bidState.bid.proofYs) {
			out.push({ auctionState, bidState, proofY })
		}
	}
	return out
}

const buildBidChain = (auctionState: ValidatorAuctionState, latestBidState: ValidatorBidState): ValidatorBidState[] => {
	const chain: ValidatorBidState[] = []
	const seen = new Set<string>()
	let current: ValidatorBidState | undefined = latestBidState
	while (current) {
		if (seen.has(current.bid.id)) break
		if (seen.size >= MAX_REPLACEMENT_CHAIN_DEPTH) break
		seen.add(current.bid.id)
		chain.push(current)
		const prevBidId = current.bid.prevBidId?.trim()
		if (!prevBidId) break
		current = auctionState.bids.get(prevBidId)
	}
	return chain
}

const defaultLogger = () => ({
	info: (...args: unknown[]) => console.log(...args),
	warn: (...args: unknown[]) => console.warn(...args),
	error: (...args: unknown[]) => console.error(...args),
})
