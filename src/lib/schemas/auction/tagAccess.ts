/**
 * Tag-array access helpers used by every auction Zod schema.
 *
 * Nostr events carry tags as `string[][]` — order matters, repetition
 * is allowed, and there's no native object shape. The auction protocol
 * is tag-heavy (auction listings have 20+ tags, validator verdicts have
 * 7+ etc.), so each per-event Zod schema needs to:
 *
 *   1. Read the raw `event.tags` array
 *   2. Pluck specific tag values (single or multi)
 *   3. Hand a clean object to a Zod `object()` schema for validation
 *
 * These helpers centralise step 2 so each per-event file just declares
 * "I need these tag names with these multiplicities" and the parser
 * loop falls out automatically.
 *
 * Notes:
 * - Tag lookups are case-sensitive (Nostr convention).
 * - The first occurrence wins for single-value lookups.
 * - We never throw — schemas fail explicitly via Zod with structured
 *   issues, not via thrown access errors.
 */

import type { NostrEventLike } from '../../nostr/eventLike'

/**
 * Read the first value (`tag[1]`) for the named tag. `undefined` when
 * the tag is absent or has no value slot.
 */
export const readSingleTag = (event: NostrEventLike, name: string): string | undefined => {
	for (const tag of event.tags) {
		if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) return tag[1]
	}
	return undefined
}

/**
 * Read all first-values for a repeating tag. e.g.
 * `["mint", "mintA"]`, `["mint", "mintB"]` → `["mintA", "mintB"]`.
 */
export const readMultiTag = (event: NostrEventLike, name: string): string[] => {
	const out: string[] = []
	for (const tag of event.tags) {
		if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) out.push(tag[1])
	}
	return out
}

/** Read the full tag tuple (so callers can use tag[2], tag[3] for compound tags). */
export const readSingleTagTuple = (event: NostrEventLike, name: string): string[] | undefined => {
	for (const tag of event.tags) {
		if (tag[0] === name) return tag
	}
	return undefined
}

export const readMultiTagTuples = (event: NostrEventLike, name: string): string[][] => {
	return event.tags.filter((tag) => tag[0] === name)
}

/**
 * Coerce a tag's value into an integer. Returns `undefined` for
 * missing tags AND for non-integer values (so the schema can decide
 * whether to use a default or fail).
 */
export const readIntegerTag = (event: NostrEventLike, name: string): number | undefined => {
	const raw = readSingleTag(event, name)
	if (raw === undefined) return undefined
	const n = Number.parseInt(raw, 10)
	if (!Number.isFinite(n)) return undefined
	if (String(n) !== raw.replace(/^[+\s]+/, '')) return undefined
	return n
}
