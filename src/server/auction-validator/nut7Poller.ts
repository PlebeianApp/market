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

	// NUT-7 polling is disabled — the client now queries the mint directly
	// via checkProofStateBatch (ADR-0004). The validator no longer polls
	// NUT-7 state or publishes nut7_state in verdicts. The tick function
	// is retained as a no-op for interface compatibility.
	const tick = async (): Promise<void> => {}

	const refreshBidChain = async (_input: { auctionRootEventId: string; bidEventId: string }): Promise<void> => {}

	const refreshAuctionReleasedNonterminal = async (_auctionRootEventId: string): Promise<void> => {}
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
