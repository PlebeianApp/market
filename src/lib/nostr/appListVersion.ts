/**
 * Ordering + versioning for app-owned list events.
 *
 * The app publishes a small set of "authority" events under its own pubkey:
 * kind 30000 `d=admins` / `d=editors`, kind 10000 blacklist and kind 31990
 * `d=plebeian-market-handler` app settings. Every one of those reads filters on
 * `authors: [appPubkey]`, so a relay cannot forge a revision — it can only
 * serve an OLDER one and hope it outranks the real latest copy.
 *
 * The original rule was `created_at` DESC alone. Because `created_at` is
 * chosen by the publisher's clock, a copy signed by a machine whose clock runs
 * fast stays "newest" forever — a relay (or a stale cache) can keep resurrecting
 * it even after the operator publishes a newer list.
 *
 * This module adds a monotonic `['version', '<n>']` tag to app-owned lists and
 * the comparison that uses it:
 *  - when BOTH copies carry a version, the higher version wins;
 *  - otherwise the legacy rule applies (`created_at` DESC, then the lower event
 *    id per NIP-01).
 *
 * The fallback is deliberate: a list published by a path that does not stamp the
 * tag yet (or a legacy event from before this change) must still win on plain
 * freshness, so mixed sets behave exactly as they do on master.
 */

/** Tag carrying the monotonic revision counter of an app-owned list event. */
export const APP_LIST_VERSION_TAG = 'version'

/**
 * Minimal structural view of an event. The NDKEvent class satisfies it, and so
 * do the lightweight shapes used in tests (no NDK instance required).
 */
export interface AppListEventLike {
	tags?: ReadonlyArray<ReadonlyArray<string | undefined>>
	created_at?: number
	id?: string
}

const VERSION_VALUE = /^\d+$/

/**
 * Read the monotonic version of an app-owned list event.
 * Returns undefined when the event carries no usable `['version', '<n>']` tag
 * (absent, non-numeric, or malformed) — callers must treat that as "unknown",
 * never as 0.
 */
export function readAppListVersion(event: AppListEventLike | null | undefined): number | undefined {
	const tags = event?.tags
	if (!tags) return undefined

	for (const tag of tags) {
		if (tag?.[0] !== APP_LIST_VERSION_TAG) continue
		const raw = tag[1]?.trim()
		if (raw === undefined || !VERSION_VALUE.test(raw)) continue
		return Number(raw)
	}

	return undefined
}

/**
 * The version a new revision of an app-owned list must carry: the current
 * version + 1, or 1 when the current copy carries no version.
 *
 * The counter never decreases and never returns a non-positive value, so two
 * revisions published in order can never tie on version.
 */
export function nextAppListVersion(current: number | undefined): number {
	if (current === undefined || !Number.isFinite(current) || current < 0) return 1
	return Math.floor(current) + 1
}

/** Tag pair to attach to an app-owned list event when signing it. */
export function appListVersionTag(version: number): [string, string] {
	return [APP_LIST_VERSION_TAG, String(version)]
}

/**
 * Legacy ordering, still the fallback: newest `created_at` first, then the
 * lowest event id (NIP-01 tie rule) so every client converges on one copy.
 * Negative result means `a` is preferred.
 */
export function compareAppListEventsByCreatedAt(a: AppListEventLike, b: AppListEventLike): number {
	const createdAtDiff = (b.created_at ?? 0) - (a.created_at ?? 0)
	if (createdAtDiff !== 0) return createdAtDiff

	const aId = a.id ?? ''
	const bId = b.id ?? ''
	if (aId === bId) return 0
	return aId < bId ? -1 : 1
}

/**
 * Order two copies of the same app-owned list. Negative result means `a` is
 * preferred. Prefers the higher `version` when both copies carry one (this is
 * what makes a clock-skewed copy unable to win), and falls back to the legacy
 * `created_at` / id rule otherwise.
 */
export function compareAppListEvents(a: AppListEventLike, b: AppListEventLike): number {
	const aVersion = readAppListVersion(a)
	const bVersion = readAppListVersion(b)
	if (aVersion !== undefined && bVersion !== undefined && aVersion !== bVersion) return bVersion - aVersion

	return compareAppListEventsByCreatedAt(a, b)
}

/**
 * Pick the copy of an app-owned list that the authority reads should use.
 *
 * Candidates are first normalised into the legacy order (newest `created_at`,
 * then lowest id); the fold then only ever upgrades the incumbent to a strictly
 * higher version. Normalising first keeps the winner independent of the order
 * the relays answered in — which is the whole point, since a relay set returns
 * copies in whatever order the sockets settle.
 */
export function selectPreferredAppListEvent<T extends AppListEventLike>(events: ReadonlyArray<T>): T | undefined {
	if (events.length === 0) return undefined

	const candidates = [...events].sort(compareAppListEventsByCreatedAt)
	return candidates.reduce<T | undefined>(
		(best, candidate) => (best === undefined || compareAppListEvents(candidate, best) < 0 ? candidate : best),
		undefined,
	)
}
