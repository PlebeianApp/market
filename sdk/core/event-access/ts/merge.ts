/**
 * merge.ts — the id-unique union, and the per-id provenance it records.
 *
 * Two rules from the spec are this file's whole job:
 *
 * - **M2 / `#b40aaa` — the merged union is id-unique.** An event returned by the local
 *   answer and by a fill is **one** event in the answer, and the union is taken here,
 *   after the merge, rather than by the caller.
 * - **M12 / `#42626d`, `#34dcaa` — provenance is per answer and per id**, with **local-first
 *   precedence**: an id the local read carried keeps `'local'` even when the fill produced it
 *   first, because `#34dcaa` states the precedence unconditionally and P2
 *   (`query{localFirst:false}`) inverts the *merge* order of the two answers, not the rule — and not
 *   the calls either, since the endpoint's read answers first on every path (`#f775fb`). Keying
 *   the record on the answering tier rather than on arrival order is the difference between
 *   a rule and an accident.
 *
 * Telling a locally answered event from a network-answered one never depends on a flag
 * mutated on a shared event instance — this module refuses the vendor's single sticky bit
 * (provenance) `#5015f4`: the record lives here, beside the answer, and the events
 * themselves are never annotated.
 */
import type { AnswerOrigin, Event } from './types'

/** #b40aaa — Union: the union of the two tiers' answers, id-unique, with the tier that produced each id. */
export class Union {
	private readonly events: Event[] = []
	private readonly seen = new Set<string>()
	private readonly origins = new Map<string, AnswerOrigin>()

	/**
	 * Add one event under one tier. Returns **true** iff the id is new — so a caller can
	 * assert exactly-once delivery and an expected write count from one return value.
	 *
	 * A known id is never a second event, but a tier that *outranks* the recorded one replaces
	 * the record: the documented tier for an id both tiers produced is the local read's,
	 * whatever order the two tiers were asked in (`#34dcaa`).
	 */
	add(event: Event, origin: AnswerOrigin): boolean {
		if (this.seen.has(event.id)) {
			if (origin === 'local') this.origins.set(event.id, 'local')
			return false
		}
		this.seen.add(event.id)
		this.events.push(event)
		this.origins.set(event.id, origin)
		return true
	}

	/** Add a whole answer; returns only the events that were **fresh** under this tier. */
	take(events: readonly Event[], origin: AnswerOrigin): Event[] {
		const fresh: Event[] = []
		for (const event of events) {
			if (this.add(event, origin)) fresh.push(event)
		}
		return fresh
	}

	/** The merged answer, in arrival order: the local answer's events first, then the fill's. */
	answer(): Event[] {
		return [...this.events]
	}

	/** A copy of the per-id provenance record, keyed by event id. */
	originsOf(): Map<string, AnswerOrigin> {
		return new Map(this.origins)
	}
}
