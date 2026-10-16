import type { CurationFilter, CurationListEvent } from './curationRead'

export const VANITY_REGISTRY = { kind: 30000, dTag: 'vanity-urls' } as const

export interface VanityEntry {
	vanityName: string
	pubkey: string
	validUntil: number
}

export interface VanitySettings<E = CurationListEvent> {
	entries: VanityEntry[]
	lastUpdated: number
	event: E | null
}

const nowInSeconds = () => Math.floor(Date.now() / 1000)

export function buildVanityRegistryFilter(appPubkey: string, limit?: number): CurationFilter {
	return {
		kinds: [VANITY_REGISTRY.kind],
		authors: [appPubkey],
		'#d': [VANITY_REGISTRY.dTag],
		...(limit !== undefined && { limit }),
	}
}

/** `["vanity", name, pubkey, validUntil]` tags; names are lowercased. */
export function readVanityEntries(tags: string[][]): VanityEntry[] {
	return tags
		.filter((tag) => tag[0] === 'vanity' && tag[1] && tag[2] && tag[3])
		.map((tag) => ({ vanityName: tag[1].toLowerCase(), pubkey: tag[2], validUntil: parseInt(tag[3]) || 0 }))
}

/** Parses the newest registry event; no events yields an empty registry. */
export function parseVanitySettings<E extends CurationListEvent>(events: readonly E[]): VanitySettings<E> {
	if (events.length === 0) return { entries: [], lastUpdated: 0, event: null }
	const latestEvent = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
	return { entries: readVanityEntries(latestEvent.tags), lastUpdated: latestEvent.created_at ?? 0, event: latestEvent }
}

export function isVanityAvailable(
	vanitySettings: VanitySettings<unknown> | null | undefined,
	vanityName: string,
	now = nowInSeconds(),
): boolean {
	if (!vanityName) return false
	if (!vanitySettings || !vanitySettings.entries) return true
	const existing = vanitySettings.entries.find((e) => e.vanityName === vanityName.toLowerCase())
	if (!existing) return true
	return existing.validUntil < now
}

export function resolveVanity(
	vanitySettings: VanitySettings<unknown> | null | undefined,
	vanityName: string,
	now = nowInSeconds(),
): VanityEntry | null {
	if (!vanitySettings || !vanitySettings.entries || !vanityName) return null
	const entry = vanitySettings.entries.find((e) => e.vanityName === vanityName.toLowerCase())
	if (!entry || entry.validUntil < now) return null
	return entry
}

export function getVanityForPubkey(
	vanitySettings: VanitySettings<unknown> | null | undefined,
	pubkey: string,
	now = nowInSeconds(),
): VanityEntry | null {
	if (!vanitySettings || !vanitySettings.entries || !pubkey) return null
	return vanitySettings.entries.find((e) => e.pubkey === pubkey && e.validUntil > now) || null
}

export function getExpiredVanityForPubkey(
	vanitySettings: VanitySettings<unknown> | null | undefined,
	pubkey: string,
	now = nowInSeconds(),
): VanityEntry[] {
	if (!vanitySettings || !vanitySettings.entries || !pubkey) return []
	return vanitySettings.entries.filter((e) => e.pubkey === pubkey && e.validUntil <= now)
}
