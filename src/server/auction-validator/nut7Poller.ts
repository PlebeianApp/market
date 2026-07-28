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
import {
	aggregateProofStates,
	collectLiveBids,
	isTerminalClaim,
	recordNut7State,
	type ValidatorAuctionState,
	type ValidatorBidState,
	type ValidatorState,
} from './state'
import { currentTopValidBidAmount } from './lifecycle'
import { refreshAuctionMintReachability } from './mintReachability'
import type { createVerdictPublisher } from './publisher'

export interface Nut7PollerDeps {
	state: ValidatorState
	publisher: ReturnType<typeof createVerdictPublisher>
	/** Per-mint NUT-7 query options (timeout etc.). Optional. */
	nut7Options?: CheckProofStateOptions
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
				await refreshAuctionMintReachability(auctionState, deps.nut7Options)
			} catch (err) {
				logger.warn(
					`[validator-nut7] mint reachability refresh failed for auction ${auctionState.auction.rootEventId.slice(0, 8)}:`,
					err instanceof Error ? err.message : err,
				)
			}
		}

		const live = collectLiveBids(deps.state, observedAt)
		if (!live.length) return
		const entries = expandProofEntries(live)
		if (!entries.length) return

		await refreshProofStates(entries, observedAt, 'tick')
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

		// Bucket Y → bid for each mint. The mint takes a flat
		// `Ys: string[]`, but we need to map results back to the
		// originating bid state when the response arrives.
		const buckets = new Map<string, MintBucket>()
		for (const entry of entries) {
			let bucket = buckets.get(entry.bidState.bid.mint)
			if (!bucket) {
				bucket = { mintUrl: entry.bidState.bid.mint, entries: [] }
				buckets.set(entry.bidState.bid.mint, bucket)
			}
			bucket.entries.push(entry)
		}

		// Run each mint's batch in parallel. Per-mint failures are
		// non-fatal — we just leave that bucket's bids' Y states as
		// `unknown` and let the next tick retry.
		await Promise.all(
			Array.from(buckets.values()).map(async (bucket) => {
				const allYs = bucket.entries.map((e) => e.proofY)
				let response: Map<string, ReturnType<typeof aggregateProofStates>> | null = null
				try {
					response = await checkProofStateBatch(bucket.mintUrl, allYs, deps.nut7Options)
				} catch (err) {
					logger.warn(`[validator-nut7] ${source} mint ${bucket.mintUrl} batch failed:`, err instanceof Error ? err.message : err)
					return
				}

				// Track which bids' aggregate state changed so we only
				// republish the affected ones.
				const dirtyBids = new Map<string, { auctionState: ValidatorAuctionState; bidState: ValidatorBidState }>()
				for (const entry of bucket.entries) {
					const next = response!.get(entry.proofY.toLowerCase()) ?? 'unknown'
					const previous = entry.bidState.nut7States.get(entry.proofY.toLowerCase())?.state
					recordNut7State(entry.bidState, entry.proofY, next, observedAt)
					if (previous !== next) dirtyBids.set(entry.bidState.bid.id, { auctionState: entry.auctionState, bidState: entry.bidState })
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
