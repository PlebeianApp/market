import { checkMintReachability, type CheckProofStateOptions } from '../../lib/cashu/nut7'
import { isMintDestinationAllowed } from './mintDestination'
import { setAuctionMintReachability, type ValidatorAuctionState } from './state'

/**
 * Operator-controlled outbound-network + load policy for mint probes.
 * Defaults are safe + deterministic: no cache (so tests/ephemeral mint
 * clients are unaffected), a sane per-auction mint cap, and bounded
 * concurrency. Production wiring overrides `cacheTtlSec` to avoid
 * re-probing healthy mints every poll tick.
 */
export interface MintProbePolicy {
	/** Reachability cache TTL in seconds. 0 (default) disables caching. */
	cacheTtlSec?: number
	/** Max mints probed per auction; extras are marked unreachable. */
	maxMintsPerAuction?: number
	/** Max concurrent mint probes across one refresh. */
	maxConcurrency?: number
	/** Allow http://localhost for local dev. */
	allowInsecureLocalhost?: boolean
}

const DEFAULT_MAX_MINTS = 8
const DEFAULT_MAX_CONCURRENCY = 4

// Module-level reachability cache. Keyed by mint URL. Only populated
// when a non-zero cacheTtlSec is configured, so default (0) never
// caches — keeping unit/integration tests deterministic.
const reachabilityCache = new Map<string, { reachable: boolean; at: number }>()

const probeConcurrently = async <T>(
	items: ReadonlyArray<T>,
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> => {
	let cursor = 0
	const run = async (): Promise<void> => {
		while (cursor < items.length) {
			const index = cursor++
			await worker(items[index]!)
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
}

export const refreshAuctionMintReachability = async (
	auctionState: ValidatorAuctionState,
	options?: CheckProofStateOptions,
	policy?: MintProbePolicy,
): Promise<boolean> => {
	const cacheTtlSec = policy?.cacheTtlSec ?? 0
	const maxMints = policy?.maxMintsPerAuction ?? DEFAULT_MAX_MINTS
	const maxConcurrency = policy?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
	const allowInsecureLocalhost = policy?.allowInsecureLocalhost ?? false

	const mintUrls = auctionState.rootAuction.mints
	const results: Array<readonly [string, boolean]> = []

	// Snapshot of mints to probe (allowed + not cache-fresh); disallowed
	// and over-cap mints are marked unreachable without any network call.
	const toProbe: string[] = []
	for (let i = 0; i < mintUrls.length; i++) {
		const mintUrl = mintUrls[i]!
		if (i >= maxMints) {
			results.push([mintUrl, false])
			continue
		}
		const dest = isMintDestinationAllowed(mintUrl, { allowInsecureLocalhost })
		if (!dest.allowed) {
			results.push([mintUrl, false])
			continue
		}
		if (cacheTtlSec > 0) {
			const cached = reachabilityCache.get(mintUrl)
			if (cached && Date.now() / 1000 - cached.at < cacheTtlSec) {
				results.push([mintUrl, cached.reachable])
				continue
			}
		}
		toProbe.push(mintUrl)
	}

	await probeConcurrently(toProbe, maxConcurrency, async (mintUrl) => {
		const reachable = await checkMintReachability(mintUrl, options)
		results.push([mintUrl, reachable])
		if (cacheTtlSec > 0) reachabilityCache.set(mintUrl, { reachable, at: Date.now() / 1000 })
	})

	setAuctionMintReachability(auctionState, results)
	return auctionState.contextStatus === 'active'
}