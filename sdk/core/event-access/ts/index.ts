/**
 * index.ts — the contract entry: exactly the symbols the module MD's `contract.exports`
 * and `contract.types` name, and nothing else. `evidence/run.sh` diffs the three lists.
 *
 * **What is genuinely ours** (`#a72685`): the ordering as a rule rather than a merge, the
 * id-unique merged union, the merged answer's provenance, the declared write-back policy,
 * and the completeness fact. The vendor supplies none of those five, and `applesauce-core`
 * — where the store lives — appears in **neither** dependency list of this module.
 *
 * The import allow-list is `./<module file>`, `applesauce-loaders[/…]`, `nostr-tools[/…]`,
 * `rxjs` and `bun:test` (tests only); no specifier leaves this directory (`#0c7fe3`, D-O19).
 */
export { createEventAccess, originOf } from './composition'
export { DEFAULT_WRITE_BACK } from './policy'
export { EventAccessError } from './errors'
export type {
	Event,
	FilterIn,
	Unsub,
	Reason,
	AnswerOrigin,
	QueryOptions,
	QueryResult,
	SubscribeOptions,
	Subscription,
	PublishOptions,
	PublishOutcome,
	CountResult,
	DeleteRef,
	DeleteOutcome,
	StoreEndpoint,
	EndpointReadOptions,
	NostrIo,
	WriteBackPolicy,
	AcceptHook,
	AcceptDecision,
	AcceptContext,
	ReferenceResolver,
	EventAccessOptions,
	EventAccess,
} from './types'
