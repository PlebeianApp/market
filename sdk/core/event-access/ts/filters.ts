/**
 * filters.ts — one-or-many normalisation, and **nothing else**.
 *
 * This file is deliberately the smallest thing that can exist beside the filter
 * boundary, because the boundary is **not here**: identity validation and the
 * match-nothing rule are the store's single implementation, reached through the
 * endpoint's `read` (`#f775fb`, D-O5). A predicate written here would be the second
 * implementation of one rule that M7 and `#d80075` refuse — the architecture
 * contradiction this module's own stop conditions name (`#f64bec`).
 *
 * So what remains is the one mechanical step NIP-01 requires before a filter reaches
 * either tier: one filter or many, always as an array — and **never with a key removed**,
 * an empty one included. Anything that is not an object is a caller error, so it is a
 * typed refusal rather than a `TypeError` from somewhere deeper. The typed refusal is
 * this module's `EventAccessError`, with a reason from its own vocabulary.
 */
import { EventAccessError } from './errors'
import type { DeleteRef, FilterIn } from './types'

/** #88163e — toFilterArray: one filter or many, always as an array. Never a key dropped, an empty one included. */
export function toFilterArray(filters: FilterIn | FilterIn[]): FilterIn[] {
	if (filters === null || typeof filters !== 'object') {
		throw new EventAccessError('rejected', `a filter must be an object or an array of objects, not ${typeof filters}`)
	}
	return Array.isArray(filters) ? [...filters] : [filters]
}

/**
 * #9c64ce — toRefArray: one removal target or many, always as an array. A bare string is one id; an array is a
 * list of targets, each of which may itself be an id, a filter, or a list of filters
 * (`DeleteRef`). No target is ever dropped.
 */
export function toRefArray(refs: DeleteRef | DeleteRef[]): DeleteRef[] {
	if (typeof refs === 'string') return [refs]
	if (Array.isArray(refs)) return [...refs]
	return [refs]
}
