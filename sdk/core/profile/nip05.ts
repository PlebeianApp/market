import { pickLatestEvent, type ProfileFilter } from './profileRead'

export const NIP05_REGISTRY = { kind: 30000, dTag: 'nip05-names' } as const

export interface Nip05Entry {
	username: string
	pubkey: string
	validUntil: number
}

export interface Nip05RegistryEvent {
	tags: string[][]
	created_at?: number
}

export interface Nip05Settings<E = Nip05RegistryEvent> {
	entries: Nip05Entry[]
	lastUpdated: number
	event: E | null
}

const nowInSeconds = () => Math.floor(Date.now() / 1000)

export function buildNip05RegistryFilter(appPubkey: string, limit?: number): ProfileFilter {
	return {
		kinds: [NIP05_REGISTRY.kind],
		authors: [appPubkey],
		'#d': [NIP05_REGISTRY.dTag],
		...(limit !== undefined && { limit }),
	}
}

/** `["nip05", username, pubkey, validUntil]` tags; usernames are lowercased. */
export function readNip05Entries(tags: string[][]): Nip05Entry[] {
	return tags
		.filter((tag) => tag[0] === 'nip05' && tag[1] && tag[2] && tag[3])
		.map((tag) => ({ username: tag[1].toLowerCase(), pubkey: tag[2], validUntil: parseInt(tag[3]) || 0 }))
}

/** Parses the newest registry event; no events yields an empty registry. */
export function parseNip05Settings<E extends Nip05RegistryEvent>(events: readonly E[]): Nip05Settings<E> {
	const latestEvent = pickLatestEvent(events)
	if (!latestEvent) return { entries: [], lastUpdated: 0, event: null }
	return { entries: readNip05Entries(latestEvent.tags), lastUpdated: latestEvent.created_at ?? 0, event: latestEvent }
}

/** Unregistered or expired usernames are available; matching is case-insensitive. */
export function isNip05Available(
	nip05Settings: Nip05Settings<unknown> | null | undefined,
	username: string,
	now = nowInSeconds(),
): boolean {
	if (!username) return false
	if (!nip05Settings || !nip05Settings.entries) return true
	const existing = nip05Settings.entries.find((e) => e.username === username.toLowerCase())
	if (!existing) return true
	return existing.validUntil < now
}

export function getNip05ForPubkey(
	nip05Settings: Nip05Settings<unknown> | null | undefined,
	pubkey: string,
	now = nowInSeconds(),
): Nip05Entry | null {
	if (!nip05Settings || !nip05Settings.entries || !pubkey) return null
	return nip05Settings.entries.find((e) => e.pubkey === pubkey && e.validUntil > now) || null
}

export function getExpiredNip05ForPubkey(
	nip05Settings: Nip05Settings<unknown> | null | undefined,
	pubkey: string,
	now = nowInSeconds(),
): Nip05Entry[] {
	if (!nip05Settings || !nip05Settings.entries || !pubkey) return []
	return nip05Settings.entries.filter((e) => e.pubkey === pubkey && e.validUntil <= now)
}
