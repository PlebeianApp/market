/**
 * policy.ts — `DEFAULT_WRITE_BACK`, the declared value, and its application.
 *
 * `#9b7257` — **the write-back policy is one declared, inspectable value** (`WriteBackPolicy`,
 * the precedent being the store's `EvictionPolicy`): what a read's fill writes, whether
 * `persist:false` is honoured, what is excluded, what a rejected write does, and the one
 * optional accept hook. A test reads it without driving a call, which is the point; the
 * alternative — a convention every call site must remember — is the measured defect this
 * module replaces (4 of 11 loader modules in one ecosystem apply the write-back, the rest
 * do not; `runs/2026-09-29-event-store/research/05-applesauce-precedent.md` §4).
 *
 * ---
 *
 * **E6, settled by this module's own install — the vendor's write-back operators are read,
 * and they cannot be adopted here.** Re-read 2026-09-30 from the copy installed inside this
 * directory (`event-access/ts/node_modules`, `applesauce-loaders` **6.2.0** exactly). The
 * findings, stated as they are:
 *
 * - `applesauce-loaders` 6.2.0 **exports none of the three names**. Its own `operators/`
 *   subpath ships `complete-on-eose`, `distinct-relays`, `distinct-timeout` and `generator`;
 *   `mapEventsToStore` and `filterDuplicateEvents` appear in its loaders only as **imports
 *   from `applesauce-core`**, and `storeEvents` appears nowhere in the tree installed **here**
 *   (`applesauce-relay` is not a dependency of this module; see the next bullet). The spec's front-matter sentence that
 *   attributes them to `applesauce-loaders` is therefore not supported by the tree.
 * - `applesauce-core` 6.2.0, present only as a **transitive** dependency of
 *   `applesauce-loaders`, confirms the survey's record byte for byte:
 *   `mapEventsToStore<T extends NostrEvent | string>(store: IEventStoreActions |
 *   IAsyncEventStoreActions, removeDuplicates?)` and the alias `filterDuplicateEvents<T>(store)`
 *   (`dist/observable/map-events-to-store.d.ts`, `.js`). `storeEvents` is `applesauce-relay`'s: its
 *   shape is read from the sibling seam's own install (`nostr-io/ts/node_modules/applesauce-relay`
 *   6.2.1, `dist/operators/store-events.d.ts`), so **that third name stays `UNVERIFIED` in this
 *   module's install** while the two above are `MEASURED` in it.
 * - **Neither can be adopted as this policy's implementation.** Both take a store object
 *   (`IEventStoreActions`), and this module has no store — it writes through the
 *   `StoreEndpoint` port — nor may it take `applesauce-core` as a dependency. Adopting them
 *   would require exactly the import this module's own spec forbids, so the policy is
 *   implemented directly against the port instead, and the mismatch is reported rather than
 *   papered over: the spec is the frozen side and the correction is the orchestrator's.
 *
 * ---
 *
 * **The exclusion rule, as this implementation spells "(kind,label)".** `excluded` is a list
 * of `"<kind>:<label>"` pairs, the label being the event's `d` tag value and the empty string
 * when it carries none. The wallet rule arrives as an **input** to this list (`#a1e6b7`): the
 * module ships no kind list and refuses nothing by kind, and the default is empty.
 */
import type { Event, WriteBackPolicy } from './types'

/**
 * #9b7257 — DEFAULT_WRITE_BACK: the declared default — write back what a fill answered (`LF-2`), honour `persist:false` for
 * the call that declares it, exclude nothing, skip a refused write silently, and accept
 * everything through `validation`'s pass-through default (the hook is absent, `#c8e35c`).
 */
export const DEFAULT_WRITE_BACK: WriteBackPolicy = {
	writeBack: 'network',
	honourPersist: true,
	excluded: [],
	onReject: 'skip',
}

/** #fe552a — exclusionLabel: the `d` tag's value, or the empty string. The one place a label is read. */
export function exclusionLabel(event: Event): string {
	const tag = event.tags.find((candidate) => candidate[0] === 'd')
	return tag?.[1] ?? ''
}

/** #7aa770 — isExcluded: is this event declared excluded by the policy? An empty list excludes nothing. */
export function isExcluded(event: Event, excluded: readonly string[]): boolean {
	if (excluded.length === 0) return false
	return excluded.includes(`${event.kind}:${exclusionLabel(event)}`)
}

/**
 * #c3818e — applyWriteBack: applies the declared policy to a fill's fresh events, and reports what the store refused.
 *
 * **The accept decision is no longer taken here** (D-O21). It was one synchronous boolean read at
 * write-back; it is now **one gate** in `composition.ts`, applied at the three destinations D-O21
 * names — the store write, the consumer delivery and the wire publish — and nowhere else. A second
 * place where an event can be accepted or rejected is the architecture contradiction D-O9 named, so
 * this function is **removed** rather than kept beside the gate: the write-back now receives a set
 * the gate has already answered for.
 *
 * What stays here, unchanged in meaning: `onReject` (a silent skip or a report), `excluded` (the
 * declared exclusion rule), and `honourPersist`. A rejection is still a **value**, never a silent
 * absence — where it has a channel it is reported with a typed reason (`#c65b19`).
 *
 * ---
 *
 * Apply the policy to a fill's fresh events. Returns the events handed to the store, and what
 * the store refused — or `undefined` when the policy writes nothing at all, which is the
 * answer for `writeBack: 'never'`, for a `persist:false` read the policy honours, and for a
 * fill whose every event is excluded or rejected by the accept boundary.
 *
 * The write is **injected as a function** rather than taken as the port, so the composition
 * can hand in its own guarded write and a foreign refusal is surfaced as this module's own
 * (D-O5, E5) at one place instead of two.
 *
 * A refused write is **not** re-attempted and does not fail the read: `onReject` decides
 * between a silent skip and a report, and it is a declared value a test reads rather than a
 * field invented on the envelope (`#dce3ab` fixes the envelope at exactly two members). Where
 * the answer cannot carry the report, the module says so rather than inventing a channel.
 */
export async function applyWriteBack(
	write: (events: Event[]) => Promise<{ stored: number; refused: number }>,
	policy: WriteBackPolicy,
	fresh: readonly Event[],
	persist: boolean,
): Promise<{ written: Event[]; refused: number } | undefined> {
	if (policy.writeBack === 'never') return undefined
	if (policy.honourPersist && !persist) return undefined
	const written = fresh.filter((event) => !isExcluded(event, policy.excluded))
	if (written.length === 0) return undefined
	const outcome = await write(written)
	return { written, refused: outcome.refused }
}
