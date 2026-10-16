import { isAddressableKind } from 'nostr-tools/kinds'
import { getEventAddress, type NostrEventLike } from '../../core/nostr/eventLike'
import { REACTION_KIND } from './reactionEvents'

const DELETION_KIND = 5

/** Raw reaction contents mapped to the emoji they are displayed as. */
const CUSTOM_EMOJI_MAP: Record<string, string> = {
	'+': '❤️',
	'-': '👎',
	'❤': '❤️',
}

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type ReactionFilter = {
	kinds: number[]
	'#k'?: string[]
	'#p'?: string[]
	'#a'?: string[]
	'#e'?: string[]
	limit?: number
}

export interface ReactionRecord<T extends { id: string } = NostrEventLike> {
	id: string
	emoji: string
	createdAt: number
	authorPubkey: string
	targetEvent: T
}

/** NIP-25 reactions on a target: `#a` for addressable targets, `#e` otherwise. */
export function buildReactionFilter(target: NostrEventLike): ReactionFilter {
	const filter: ReactionFilter = {
		kinds: [REACTION_KIND],
		'#k': [target.kind.toString()],
		'#p': [target.pubkey],
		limit: 100,
	}

	if (isAddressableKind(target.kind)) {
		filter['#a'] = [getEventAddress(target)]
	} else {
		filter['#e'] = [target.id]
	}

	return filter
}

/** NIP-09 deletion requests referencing any of the given reaction ids. */
export function buildReactionDeletionFilter(reactionIds: string[]): ReactionFilter {
	return { kinds: [DELETION_KIND], '#e': reactionIds }
}

export function parseReaction<T extends { id: string }>(event: NostrEventLike, targetEvent: T): ReactionRecord<T> {
	return {
		id: event.id,
		emoji: event.content,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		authorPubkey: event.pubkey,
		targetEvent,
	}
}

/** Apply custom character mappings; colon-syntax custom emojis (e.g. `:zapstore:`) fall back to ❤️. */
export function normalizeReactionEmoji(emoji: string): string {
	if (CUSTOM_EMOJI_MAP[emoji]) {
		return CUSTOM_EMOJI_MAP[emoji]
	}
	if (emoji.startsWith(':')) {
		return '❤️'
	}
	return emoji
}

/** Keep only the newest reaction per (target, author, raw emoji). */
export function filterForLatestReactionsOnly<R extends ReactionRecord<{ id: string }>>(reactions: R[]): R[] {
	const reactionsByUserEmoji = new Map<string, R>()

	reactions.forEach((reaction) => {
		const identifier = reaction.targetEvent.id + reaction.authorPubkey + reaction.emoji
		const existingEntry = reactionsByUserEmoji.get(identifier)

		if (!existingEntry || reaction.createdAt > existingEntry.createdAt) {
			reactionsByUserEmoji.set(identifier, reaction)
		}
	})

	return Array.from(reactionsByUserEmoji.values())
}

/** Group by normalized emoji, keeping the first reaction per author within a group. */
export function groupReactionsByContent<R extends ReactionRecord<{ id: string }>>(reactions: R[]): Map<string, R[]> {
	const grouped = new Map<string, R[]>()

	reactions.forEach((reaction) => {
		const emoji = normalizeReactionEmoji(reaction.emoji)

		if (!grouped.has(emoji)) {
			grouped.set(emoji, [])
		}

		const existingReactions = grouped.get(emoji) || []
		// Raw `r.emoji` vs normalized `emoji`: aliased reactions (e.g. '+') are not deduped here.
		const hasSameUserReaction = existingReactions.some((r) => r.authorPubkey === reaction.authorPubkey && r.emoji === emoji)

		if (!hasSameUserReaction) {
			grouped.get(emoji)!.push(reaction)
		}
	})

	return grouped
}

/** Group by normalized emoji, largest group first. */
export function sortReactionsIntoGroups<R extends ReactionRecord<{ id: string }>>(reactions: R[]): Map<string, R[]> {
	const groupReactions = groupReactionsByContent(reactions)
	return new Map(Array.from(groupReactions).sort((a, b) => (a[1].length > b[1].length ? -1 : 1)))
}

/** Ids referenced by `e` tags of deletion events. */
export function collectDeletedEventIds(deletionEvents: Iterable<{ tags: string[][] }>): Set<string> {
	const ids = new Set<string>()
	Array.from(deletionEvents)
		.flatMap((e) => e.tags.filter((t) => t[0] === 'e'))
		.map((t) => t?.[1])
		.forEach((id) => ids.add(id))
	return ids
}

export function removeDeletedReactions<R extends { id: string }>(reactions: R[], deletedIds: Set<string>): R[] {
	return reactions.filter((reaction) => !deletedIds.has(reaction.id))
}

/** Newest first; sorts in place like the original fetch path. */
export function sortReactionsNewestFirst<R extends { createdAt: number }>(reactions: R[]): R[] {
	return reactions.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
}
