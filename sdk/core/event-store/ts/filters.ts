/**
 * filters.ts — M7 (fail closed on identity inputs) and E3's declaration.
 *
 * Two rules, and they pull in opposite directions on purpose:
 *
 * - a **malformed** identity value is rejected, never repaired. No trimming, no
 *   lower-casing, no dropping of an empty entry — relaying canonicalises to
 *   lower case and ADR-015 §1 rejects *broadening* an identity-scoped request
 *   instead of rejecting it;
 * - an **empty** identity list is legal and is kept. NIP-01 makes `[]` match
 *   nothing; dropping it would broaden the filter to everything, which is the
 *   same fail-open shape in the other direction.
 */
import { StoreError } from './errors'
import type { FilterIn, FilterSupport } from './types'

/**
 * #e8d56c — FILTER_SUPPORT: the filter capabilities this implementation declares.
 *
 * **E3's declaration.** The contract requires the declaration, not the support.
 * This implementation honours NIP-91 `&`-keys (the underlying index does, and so
 * does the predicate it is filtered by) and does **not** honour NIP-50 `search`;
 * a `search` field is accepted and does not filter.
 */
export const FILTER_SUPPORT: FilterSupport = { nip91: true, nip50: false }

/** #9b4105 — IDENTITY_KEYS: the filter keys that carry an identity, and therefore the ones M7 guards. */
export const IDENTITY_KEYS = ['ids', 'authors', '#e', '#p', '#P'] as const

/** A relay identity is a lower-case hex string, and an id is at most 64 of them. */
const MAX_IDENTITY_LENGTH = 64
const HEX = /^[0-9a-f]+$/

/**
 * One filter or many, always as an array — and **never with a key removed**, an
 * empty one included (M7). Anything that is not an object is a caller error, so
 * it is a typed rejection rather than a `TypeError` from somewhere deeper.
 */
export function toFilterArray(filters: FilterIn | FilterIn[]): FilterIn[] {
	if (filters === null || typeof filters !== 'object') {
		throw new StoreError('rejected', `a filter must be an object or an array of objects, not ${typeof filters}`)
	}
	return Array.isArray(filters) ? [...filters] : [filters]
}

/**
 * #9b4105 — assertIdentityFilters: M7, applied to every identity key of every filter.
 *
 * M7, applied to every identity key of every filter before a filter reaches the
 * store, the index or a subscription: each present value must be an array whose
 * elements are non-empty lower-case hex strings of at most 64 characters. A
 * prefix shorter than 64 is legal — NIP-01 allows it and this is not the place
 * to be stricter than the protocol.
 */
export function assertIdentityFilters(filters: FilterIn[]): void {
	for (const filter of filters) {
		for (const key of IDENTITY_KEYS) {
			const value = filter[key]
			if (value === undefined) continue
			if (!Array.isArray(value)) {
				throw new StoreError('rejected', `${key} must be an array of hex identifiers`)
			}
			for (let index = 0; index < value.length; index++) {
				const element = value[index]
				if (typeof element !== 'string' || element.length === 0 || element.length > MAX_IDENTITY_LENGTH || !HEX.test(element)) {
					throw new StoreError(
						'rejected',
						`${key}[${index}] is not a lower-case hex identifier of at most ${MAX_IDENTITY_LENGTH} characters`,
					)
				}
			}
		}
	}
}

/**
 * #2e71c3 — matchesNothing: a filter whose any `#`-key list is present and empty matches nothing.
 *
 * M7's other half, and the one that needs its own predicate: a filter whose
 * identity list is **present and empty** matches nothing, and it is **answered as
 * nothing rather than dropped**. NIP-01 requires "at least one of the arrays'
 * values" to match, which an empty list cannot satisfy
 * (`https://raw.githubusercontent.com/nostr-protocol/nips/master/01.md:139`,
 * retrieved 2026-09-29). Skipping the filter keeps "never dropped" true; removing
 * the key would broaden the filter to everything, which is the same fail-open
 * shape from the other side.
 *
 * It is deliberately separate from `assertIdentityFilters`: a **malformed** value
 * is a typed rejection, an **empty** list is a legal filter with a known answer,
 * and the two must not be conflated.
 *
 * The underlying library does not implement this: an empty `#`-key is skipped both
 * by its predicate (`applesauce-core` 6.2.0 `dist/helpers/filter.js:66`) and by its
 * index (`dist/event-store/event-memory.js:429`, then `:467-469` returns every
 * event when no condition applied), while `nostr-tools` 2.19.4 — the reference
 * implementation, and what this module's `ids`/`authors` arms already follow —
 * treats the same filter as match-nothing (`lib/esm/filter.js:24`). This predicate
 * is where the module's own rule wins over the dependency's behaviour, applied at
 * all three call sites in `store.ts`.
 *
 * **From I3a on the rule is general rather than identity-only** — the orchestrator's decision D-O6 and the
 * statement `#2e71c3`: every `#`-key is treated the way the identity keys already were, so a
 * present-but-empty `#d`, `#a` or `#t` list matches nothing and is answered as nothing. Before this
 * increment the module implemented the narrower rule and claimed nothing wider; the specification and the
 * code agree here now.
 */
export function matchesNothing(filter: FilterIn): boolean {
	// **D-O6 / `#2e71c3` — the rule is GENERAL from I3a on.** One pass over the filter's own keys: an empty
	// `ids` or `authors` list matches nothing (M7's identity half, `#9b4105`), and so does **any** `#`-key
	// list that is present and empty — `#d`, `#a`, `#t` and the rest — which is NIP-01's rule adopted as the
	// project's. A key that is absent, or present with a non-empty list, is not this predicate's business.
	for (const [key, value] of Object.entries(filter)) {
		if (!Array.isArray(value) || value.length !== 0) continue
		if (key === 'ids' || key === 'authors' || key.startsWith('#')) return true
	}
	return false
}
