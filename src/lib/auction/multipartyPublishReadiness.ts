/**
 * Auction multiparty publish readiness — the draft-time liveness obligation.
 *
 * Maintainer direction 2026-09-22 (see
 * `docs/adr/proposals/auction-v4v-participation.md` D13): before an auction is
 * published, the seller's client must check that **every scheduled entry** —
 * validators and V4V recipients alike — is reachable and willing to take part, and
 * publishing is blocked by default while any entry is unconfirmed.
 *
 * This is a client obligation, not a protocol rule: nothing on the wire mandates a
 * liveness signal and no new event kind is introduced for one. A third-party client
 * that skips the check still publishes a valid auction. The obligation exists
 * because auctions are time-sensitive: repairing a dead-leg auction after
 * publication means re-publishing the root, which changes the schedule commitment
 * that bidders' locks are bound to.
 *
 * This module is the **projection** only: it turns liveness observations into a
 * readiness decision. Acquiring the observations (what the probe is, its timeout,
 * its retry policy) depends on the Gate D2 wire and is deliberately not decided
 * here.
 *
 * Pure: no relay, wallet, Cashu or persistence I/O.
 */

export type MultipartyLivenessStatus = 'online' | 'offline' | 'unknown'

/** How conservatively a status ranks: a lower value is less confirming. */
const STATUS_RANK: Record<MultipartyLivenessStatus, number> = {
	offline: 0,
	unknown: 1,
	online: 2,
}

export interface MultipartyLivenessObservation {
	readonly pubkey: string
	readonly status: MultipartyLivenessStatus
	/** When the observation was made. Missing means "time unknown". */
	readonly observedAtUnixSeconds?: number
}

export type MultipartyUnconfirmedReason = 'offline' | 'unknown' | 'stale' | 'not_observed'

export interface MultipartyPublishReadinessInput {
	/** Every scheduled entry: validators plus V4V recipients. */
	readonly scheduledPubkeys: readonly string[]
	readonly observations: readonly MultipartyLivenessObservation[]
	/**
	 * Whether the obligation blocks publishing. Default true. A false value records
	 * an explicit seller override; the caller is responsible for surfacing it.
	 */
	readonly enforce?: boolean
	readonly nowUnixSeconds?: number
	/** Observations older than this are treated as unconfirmed. */
	readonly maxObservationAgeSeconds?: number
}

export interface MultipartyPublishReadiness {
	/** True only when every scheduled entry is confirmed online and fresh. */
	readonly ready: boolean
	readonly scheduledCount: number
	readonly confirmedPubkeys: readonly string[]
	readonly unconfirmed: readonly {
		readonly pubkey: string
		readonly reason: MultipartyUnconfirmedReason
	}[]
	readonly warnings: readonly string[]
	/** True when the obligation is why publishing is not allowed. */
	readonly blockedByObligation: boolean
}

const comparePubkeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Reduce observations to one status per pubkey.
 *
 * Deterministic and fail-closed: the newest observation wins, and when two
 * observations share a timestamp the **least confirming** status wins. Input order
 * therefore cannot change the outcome.
 */
const reduceObservations = (observations: readonly MultipartyLivenessObservation[]): Map<string, MultipartyLivenessObservation> => {
	const reduced = new Map<string, MultipartyLivenessObservation>()
	for (const observation of observations) {
		const current = reduced.get(observation.pubkey)
		if (!current) {
			reduced.set(observation.pubkey, observation)
			continue
		}
		const currentAt = current.observedAtUnixSeconds ?? Number.NEGATIVE_INFINITY
		const nextAt = observation.observedAtUnixSeconds ?? Number.NEGATIVE_INFINITY
		if (nextAt > currentAt) {
			reduced.set(observation.pubkey, observation)
			continue
		}
		if (nextAt === currentAt && STATUS_RANK[observation.status] < STATUS_RANK[current.status]) {
			reduced.set(observation.pubkey, observation)
		}
	}
	return reduced
}

export const projectMultipartyPublishReadiness = (input: MultipartyPublishReadinessInput): MultipartyPublishReadiness => {
	const scheduled = Array.from(new Set(input.scheduledPubkeys)).sort(comparePubkeys)
	const enforce = input.enforce ?? true
	const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000)
	const maxAge = input.maxObservationAgeSeconds
	const reduced = reduceObservations(input.observations)

	const confirmedPubkeys: string[] = []
	const unconfirmed: { pubkey: string; reason: MultipartyUnconfirmedReason }[] = []

	for (const pubkey of scheduled) {
		const observation = reduced.get(pubkey)
		if (!observation) {
			unconfirmed.push({ pubkey, reason: 'not_observed' })
			continue
		}
		if (observation.status === 'offline') {
			unconfirmed.push({ pubkey, reason: 'offline' })
			continue
		}
		if (observation.status === 'unknown') {
			unconfirmed.push({ pubkey, reason: 'unknown' })
			continue
		}
		if (maxAge !== undefined && (observation.observedAtUnixSeconds === undefined || now - observation.observedAtUnixSeconds > maxAge)) {
			unconfirmed.push({ pubkey, reason: 'stale' })
			continue
		}
		confirmedPubkeys.push(pubkey)
	}

	const ready = scheduled.length > 0 && unconfirmed.length === 0
	const warnings = new Set<string>()
	if (scheduled.length === 0) {
		warnings.add('no_scheduled_entries')
	}
	if (unconfirmed.length > 0) {
		warnings.add('entries_unconfirmed')
	}
	if (unconfirmed.length > 0 && !enforce) {
		warnings.add('liveness_not_enforced')
	}

	return Object.freeze({
		ready,
		scheduledCount: scheduled.length,
		confirmedPubkeys: Object.freeze(confirmedPubkeys),
		unconfirmed: Object.freeze(unconfirmed),
		warnings: Object.freeze(Array.from(warnings)),
		blockedByObligation: unconfirmed.length > 0 && enforce,
	})
}

/**
 * Client-facing reason text for a blocked publish, so the UI, the publish gate and
 * tests share one wording.
 */
export const describePublishBlock = (readiness: MultipartyPublishReadiness): string | null => {
	if (!readiness.blockedByObligation) {
		return null
	}
	const names = readiness.unconfirmed.map((entry) => `${entry.pubkey.slice(0, 8)}… (${entry.reason})`)
	return (
		`${readiness.unconfirmed.length} of ${readiness.scheduledCount} scheduled recipient(s) could ` +
		`not be confirmed: ${names.join(', ')}. Publishing a live auction with an unconfirmed ` +
		'recipient risks a dead leg that cannot be repaired without re-publishing the auction.'
	)
}
