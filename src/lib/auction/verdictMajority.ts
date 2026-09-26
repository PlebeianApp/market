/**
 * The strict-majority quorum floor for a validator pool.
 *
 * AUCTIONS.md §4.1 (amendment) / ADR-0003 amendment: two disjoint groups of
 * validators must never both be able to reach quorum on opposite outcomes, because
 * then both outcomes would be "valid" and the auction would have no single canonical
 * result. With pool size `P`, the smallest count no disjoint set can match is
 * `floor(P / 2) + 1`.
 *
 * Held in one module so the verdict tally (`verdictQuorum.ts`) and the participation
 * gate (`multipartyParticipation.ts`) cannot drift apart on the same invariant.
 *
 * | pool `P` | floor |
 * | -------- | ----- |
 * | 0 or 1   | 1     |
 * | 2        | 2     |
 * | 3        | 2     |
 * | 4        | 3     |
 * | 5        | 3     |
 * | 6        | 4     |
 */
export const requiredVerdictMajority = (poolSize: number): number =>
	!Number.isSafeInteger(poolSize) || poolSize <= 1 ? 1 : Math.floor(poolSize / 2) + 1

/**
 * The requirement actually enforced: the declared `auditor_quorum` may only ever
 * RAISE the bar, never lower it below the majority floor. A seller who declares `1`
 * for a four-validator auction does not get a forkable auction — clients apply `3`
 * and surface the discrepancy (`declaredBelowMajority` / `quorum_below_majority`)
 * instead of silently honouring the weaker value.
 */
export const effectiveVerdictQuorum = (declared: number | undefined, poolSize: number): number => {
	const declaredValue = declared && Number.isSafeInteger(declared) && declared > 0 ? declared : 1
	return Math.max(declaredValue, requiredVerdictMajority(poolSize))
}
