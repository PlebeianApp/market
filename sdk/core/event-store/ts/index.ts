/**
 * index.ts — the contract entry.
 *
 * Exactly the module MD's `contract.exports` and `contract.types`, and nothing
 * more: a delivered export the spec does not declare, or a declared one that does
 * not exist, breaks the contract diff `evidence/run.sh` prints. Nothing in the
 * module reads this repository, the app or a host: the specifier allow-list is
 * `./<module file>`, `applesauce-core[/…]`, `nostr-tools[/…]`, `rxjs` and
 * `bun:test` (tests only).
 *
 * **The surface is the endpoint** (`#e472d3`, `#5dcce6`): the five caller-facing verbs and the envelope
 * left on 2026-09-29 (`#f54c68`), and this entry exports the local read/write endpoint instead. The two
 * predicate names — `assertIdentityFilters` and `matchesNothing` — are exported **because the predicate
 * has one implementation and this is where it lives** (D-O18): a consumer's fake can be a differential
 * against the real one instead of a model of it, and a second implementation anywhere is the defect this
 * export exists to make visible.
 */
export { createEventStore } from './store'
export { FILTER_SUPPORT, assertIdentityFilters, matchesNothing } from './filters'
export { StoreError } from './errors'
export { compareVersions, collapseToHeads } from './heads'
export {
	createReplaceableAddress,
	getEventUID,
	getMatchingTags,
	getReplaceableIdentifier,
	isAddressable,
	isFromCache,
	isReplaceable,
	tagValue,
} from './view'
export type {
	Event,
	FilterIn,
	Reason,
	ClockPort,
	FilterSupport,
	EndpointTier,
	EndpointReadOptions,
	EndpointWriteOutcome,
	StoreEndpoint,
	CountResult,
	DeleteRef,
	DeleteOutcome,
	EvictionPolicy,
	EventDatabase,
	AsyncEventDatabase,
	EventStoreOptions,
	EventStore,
	EventPersistence,
} from './types'
