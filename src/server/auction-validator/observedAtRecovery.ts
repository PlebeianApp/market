/**
 * First-observation `observed_at` recovery on validator restart.
 *
 * The validator is memory-only (`state.ts`: "No DB. No persistence.") so a
 * restart wipes every bid's `observedAt` — the validator's own first-sight
 * timestamp. The subscriber then re-stamps each replayed historical bid
 * `observedAt = now()` (restart time). For an auction that has already
 * closed (`now > max_end_at`), that re-stamped `observed_at` is outside the
 * auction window, so `validateBid`'s T2.3 check (§2.3) flips every in-window
 * bid to `bid_invalid: late_arrival`. The close snapshot then finds no
 * `valid_bid_placed` bids → `pickWinningBid` returns null → the winner is
 * never assigned → `won_pending_settlement` is never published. This is the
 * root cause of the "Cannot release path: only 0/1 auditors confirmed
 * won_pending_settlement" failure observed in manual testing (PR #1144).
 *
 * Fix: on startup, before the subscriber begins replaying bids, fetch this
 * validator's OWN prior kind-30440 verdicts from the relay and recover the
 * earliest `observed_at` per `bid_event_id`. A bid the validator already saw
 * and published a verdict for carries its true first-observation timestamp
 * in the `observed_at` tag (the publisher stamps `observed_at` = the bid's
 * `observedAt` on EVERY verdict, per ADR-0003 §2.3 amendment). Seeding
 * `observedAt` from that tag restores the in-window timestamp so re-derivation
 * no longer produces `late_arrival`.
 *
 * Limitations (documented in ADR-0003 amendment):
 *  - A bid the validator observed but never published a verdict for (e.g. it
 *    crashed between observing and publishing) has no recoverable timestamp;
 *    it falls back to `now()` and may be `late_arrival`. This window is
 *    sub-second and the bid would have been `pending` anyway.
 *  - If a PRIOR restart already published a `late_arrival` with a re-stamped
 *    `observed_at`, that poisoned value is what the relay returns. Taking the
 *    MIN across all of the validator's verdicts for a bid recovers the
 *    earliest (true) first observation as long as an in-window `valid_bid_placed`
 *    verdict survives on the relay. The per-bid d-tag (ADR-0003 §4.4.1
 *    amendment) ensures the in-window verdict is not deleted by a later
 *    rebid's verdict, so the true timestamp survives.
 *
 * The relay pool only exposes `subscribe` (no synchronous fetch); this module
 * wraps a bounded subscribe-until-EOSE collection so it is injectable in
 * tests without network access. The pure projection (`buildObservedAtSeed`)
 * is exported separately for unit testing.
 */

import type { ApplesauceRelayPool } from '@contextvm/sdk'
import type { NostrEvent } from 'nostr-tools'
import { VALIDATOR_VERDICT_KIND } from '../../lib/auction/constants'

/** Look-back window for the validator's own prior verdicts (30 days, matching the subscriber). */
export const RECOVERY_LOOKBACK_SECONDS = 60 * 60 * 24 * 30

/** Bounded wait for the recovery fetch before giving up (EOSE may be slow on cold relays). */
export const RECOVERY_TIMEOUT_MS = 10_000

/** Map of `bidEventId → earliest recovered observed_at` (unix seconds). */
export type ObservedAtSeed = Map<string, number>

export interface RecoverObservedAtDeps {
	relayPool: Pick<ApplesauceRelayPool, 'subscribe'>
	validatorPubkey: string
	/** Override "current time" for tests. Defaults to `Date.now() / 1000`. */
	now?: () => number
	/** Bounded wait override for tests. */
	timeoutMs?: number
	logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}

/**
 * Pure projection: given the validator's own kind-30440 raw verdict events,
 * build a `bidEventId → earliest observed_at` seed. The earliest verdict for
 * a bid carries the first observation (the publisher stamps the same
 * `observed_at` on every verdict for a bid, but taking the MIN is defensive
 * against any anomaly). Malformed events (missing `bid` or `observed_at`
 * tags, or non-numeric `observed_at`) are skipped.
 */
export const buildObservedAtSeed = (verdictEvents: NostrEvent[]): ObservedAtSeed => {
	const seed: ObservedAtSeed = new Map()
	for (const event of verdictEvents) {
		const bid = readSingleTag(event, 'bid')
		const observedAtRaw = readSingleTag(event, 'observed_at')
		if (!bid || !observedAtRaw) continue
		const observedAt = Number.parseInt(observedAtRaw, 10)
		if (!Number.isFinite(observedAt) || observedAt <= 0) continue
		const existing = seed.get(bid)
		if (existing === undefined || observedAt < existing) {
			seed.set(bid, observedAt)
		}
	}
	return seed
}

const readSingleTag = (event: NostrEvent, name: string): string | undefined => {
	for (const tag of event.tags ?? []) {
		if (Array.isArray(tag) && tag.length >= 2 && tag[0] === name) {
			return tag[1]
		}
	}
	return undefined
}

/**
 * I/O wrapper: subscribe to this validator's own kind-30440 verdicts on the
 * relay, collect until EOSE (or a bounded timeout), and project the seed.
 * Best-effort — a fetch failure or timeout yields an empty seed and the
 * validator falls back to the legacy `now()` stamping (no worse than before).
 */
export const recoverObservedAt = async (deps: RecoverObservedAtDeps): Promise<ObservedAtSeed> => {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
	const logger = deps.logger ?? defaultLogger()
	const timeoutMs = deps.timeoutMs ?? RECOVERY_TIMEOUT_MS

	const collected: NostrEvent[] = []
	let settled = false
	const finish = () => {
		if (settled) return
		settled = true
	}

	const since = now() - RECOVERY_LOOKBACK_SECONDS
	const filters = [
		{
			kinds: [VALIDATOR_VERDICT_KIND as unknown as number],
			authors: [deps.validatorPubkey],
			since,
		},
	]

	let unsubscribe: (() => void) | null = null
	try {
		unsubscribe = await deps.relayPool.subscribe(
			filters,
			(event: NostrEvent) => {
				collected.push(event)
			},
			() => {
				// EOSE — relay finished replaying historical verdicts.
				finish()
			},
		)
	} catch (err) {
		logger.warn(`[validator] observed_at recovery subscribe failed:`, err instanceof Error ? err.message : err)
		return new Map()
	}

	// Bounded wait: resolve on EOSE or timeout, whichever fires first.
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			finish()
			resolve()
		}, timeoutMs)
		const interval = setInterval(() => {
			if (settled) {
				clearInterval(interval)
				clearTimeout(timer)
				resolve()
			}
		}, 25)
	})

	try {
		unsubscribe?.()
	} catch {
		// Pool may already be tearing down — ignore.
	}

	const seed = buildObservedAtSeed(collected)
	logger.info(`[validator] observed_at recovery: ${seed.size} bid(s) seeded from ${collected.length} prior verdict(s)`)
	return seed
}

const defaultLogger = () => ({
	info: (...args: unknown[]) => console.log(...args),
	warn: (...args: unknown[]) => console.warn(...args),
	error: (...args: unknown[]) => console.error(...args),
})
