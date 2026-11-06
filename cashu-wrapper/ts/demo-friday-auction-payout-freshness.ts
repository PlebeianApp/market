/** Freshness is checked against authenticated Comet time, never RPC status time.
 * Security requires a trustworthy host clock and an explicitly reviewed policy.
 * No policy means new catalog authorization/selection is disabled, not recovery.
 */
import { authenticatedDemoCometState, type DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'

export interface DemoFridayAuctionPayoutFreshnessPolicy {
	maximumHeadAgeSeconds: number
	maximumFutureSkewSeconds: number
}

/** Operational bound, separate from the deployment-owned head-age/skew policy. */
export const DEMO_FRIDAY_AUCTION_PAYOUT_READ_TIMEOUT_MS = 15_000

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_PAYOUT_FRESHNESS: ${message}`) }

function exactPolicy(policy: DemoFridayAuctionPayoutFreshnessPolicy): DemoFridayAuctionPayoutFreshnessPolicy {
	if (!Number.isSafeInteger(policy.maximumHeadAgeSeconds) || policy.maximumHeadAgeSeconds < 1
		|| !Number.isSafeInteger(policy.maximumFutureSkewSeconds) || policy.maximumFutureSkewSeconds < 0
		|| policy.maximumFutureSkewSeconds > policy.maximumHeadAgeSeconds) refuse('explicit freshness policy is invalid')
	return Object.freeze({ ...policy })
}

/** Deployment-owned configuration. Never read these values from a browser request. */
export function demoFridayAuctionPayoutFreshnessPolicyFromEnv(env: Record<string, string | undefined>): DemoFridayAuctionPayoutFreshnessPolicy | undefined {
	const age = env.PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS
	const skew = env.PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS
	if (age === undefined && skew === undefined) return undefined
	if (age === undefined || skew === undefined || !/^[1-9][0-9]*$/.test(age) || !/^(0|[1-9][0-9]*)$/.test(skew)) {
		refuse('both explicit integer freshness settings are required')
	}
	return exactPolicy({ maximumHeadAgeSeconds: Number(age), maximumFutureSkewSeconds: Number(skew) })
}

export function createDemoFridayFreshPayoutStateReader(options: {
	reader: DemoParticipantConsensusReader
	chainId: string
	validatorsHash: string
	policy: DemoFridayAuctionPayoutFreshnessPolicy | undefined
	readTimeoutMs: number
	nowSeconds?: () => number
}) {
	const policy = options.policy === undefined ? undefined : exactPolicy(options.policy)
	if (!Number.isSafeInteger(options.readTimeoutMs) || options.readTimeoutMs < 1 || options.readTimeoutMs > 60_000) {
		refuse('authenticated Comet read timeout is invalid')
	}
	const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	let maximumObservedClock = 0
	function clock(): number {
		const value = now()
		if (!Number.isSafeInteger(value) || value < 1 || value < maximumObservedClock) refuse('host clock is invalid or regressed')
		maximumObservedClock = value
		return value
	}
	return async () => {
		if (policy === undefined) refuse('new auction payouts require explicit deployment freshness settings')
		const abort = new AbortController()
		let timer: ReturnType<typeof setTimeout> | undefined
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				abort.abort()
				reject(new Error('DEMO_FRIDAY_PAYOUT_FRESHNESS: authenticated Comet read timed out'))
			}, options.readTimeoutMs)
		})
		const collect = async () => {
			clock()
			if (await options.reader.readChainId(abort.signal) !== options.chainId) refuse('authenticated reader chain differs')
			abort.signal.throwIfAborted()
			const result = await authenticatedDemoCometState(options.reader, options.validatorsHash, 1, abort.signal)
			abort.signal.throwIfAborted()
			const observedAt = clock()
			if (result.observation.state.chain_id !== options.chainId) refuse('authenticated state chain differs')
			const age = observedAt - result.bindingCommit.blockTime
			if (age > policy.maximumHeadAgeSeconds) refuse('authenticated payout state is stale')
			if (age < -policy.maximumFutureSkewSeconds) refuse('authenticated payout state is future-dated')
			return result
		}
		try { return await Promise.race([collect(), timeout]) }
		finally { if (timer !== undefined) clearTimeout(timer) }
	}
}
