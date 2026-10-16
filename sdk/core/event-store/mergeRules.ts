import type { NostrEventLike } from '../nostr/eventLike'

export const DELETION_REQUEST_KIND = 5

export function isReplaceableKind(kind: number): boolean {
	return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
}

export function isAddressableKind(kind: number): boolean {
	return kind >= 30000 && kind < 40000
}

export function getDTag(event: Pick<NostrEventLike, 'tags'>): string {
	return event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
}

/** Key shared by all versions of a replaceable/addressable event; null for regular events. */
export function getReplaceableKey(event: Pick<NostrEventLike, 'kind' | 'pubkey' | 'tags'>): string | null {
	if (isAddressableKind(event.kind)) return `${event.kind}:${event.pubkey}:${getDTag(event)}`
	if (isReplaceableKind(event.kind)) return `${event.kind}:${event.pubkey}`
	return null
}

/** NIP-01: newer `created_at` wins; ties go to the lexically lowest id. */
export function isNewerVersion(candidate: NostrEventLike, current: NostrEventLike): boolean {
	const candidateAt = candidate.created_at ?? 0
	const currentAt = current.created_at ?? 0
	if (candidateAt !== currentAt) return candidateAt > currentAt
	return candidate.id < current.id
}

export interface DeletionTargets {
	eventIds: string[]
	/** `kind:pubkey:d` coordinates deleted up to `deletedAt`. */
	coordinates: string[]
	deletedAt: number
	author: string
}

/** Reads a NIP-09 deletion request; only targets owned by its author are honoured. */
export function readDeletionTargets(deletion: NostrEventLike): DeletionTargets {
	return {
		eventIds: deletion.tags.filter((tag) => tag[0] === 'e' && tag[1]).map((tag) => tag[1]),
		coordinates: deletion.tags
			.filter((tag) => tag[0] === 'a' && tag[1])
			.map((tag) => tag[1])
			.filter((coordinate) => coordinate.split(':')[1] === deletion.pubkey),
		deletedAt: deletion.created_at ?? 0,
		author: deletion.pubkey,
	}
}

/** True when `deletion` removes `event` under NIP-09 (same author; coordinate deletes only reach older-or-equal versions). */
export function isDeletedBy(event: NostrEventLike, deletion: DeletionTargets): boolean {
	if (event.pubkey !== deletion.author) return false
	if (deletion.eventIds.includes(event.id)) return true
	const key = getReplaceableKey(event)
	if (!key || !isAddressableKind(event.kind)) return false
	return deletion.coordinates.includes(key) && (event.created_at ?? 0) <= deletion.deletedAt
}
