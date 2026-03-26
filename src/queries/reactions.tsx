import { ndkActions } from '@/lib/stores/ndk'
import { reactionKeys } from './queryKeyFactory'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

/**
 * NIP-25 Reaction kind
 * Note that this only applies to *Nostr events*.
 * Reactions to external events should be of kind 17.
 * https://github.com/nostr-protocol/nips/blob/master/25.md
 */
const REACTION_KIND = 7
// const REACTION_KIND_EXTERNAL = 17

/**
 * Configuration for custom character-to-emoji mappings.
 * Keys are the raw input characters, values are the target emojis.
 */
const CUSTOM_EMOJI_MAP: Record<string, string> = {
	'+': '❤️',
	'-': '👎',
	'❤': '❤️',
	// Add more mappings here as needed
}

export interface Reaction {
	id: string
	emoji: string
	createdAt: number
	authorPubkey: string
	targetEventKind: string
	targetEventId: string
	targetAuthorPubkey: string
}

const transformReactionEvent = (event: NDKEvent): Reaction => {
	// If there are more than 1 e-tags (not recommended), the event being reacted to should be the last one.
	const eTag = event.tags.filter((t) => t[0] === 'e')?.[-1]
	// Similar for p-tags
	const pTag = event.tags.filter((t) => t[0] === 'p')?.[-1]
	const kTag = event.tags.find((t) => t[0] === 'k')?.[1]

	return {
		id: event.id,
		emoji: event.content,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		authorPubkey: event.pubkey,
		targetEventKind: kTag || '',
		targetEventId: eTag?.[1] || '',
		targetAuthorPubkey: pTag?.[1] || '',
	}
}

/**
 * Normalizes an emoji string by:
 * 1. Applying custom character mappings if defined.
 * 2. Removing invisible variation selectors and tag characters.
 *
 * @param emoji - The raw emoji string from the reaction
 * @returns A normalized, clean emoji string
 */
const normalizeEmoji = (emoji: string): string => {
	// 1. Apply custom mapping first
	if (CUSTOM_EMOJI_MAP[emoji]) {
		return CUSTOM_EMOJI_MAP[emoji]
	}

	// 2. Handle custom emojis that use colon syntax (e.g. `:zapstore:`)
	// Note that we can add custom emoji support in the future.
	if (emoji.startsWith(':')) {
		return '❤️' // Default fallback for colon syntax if not mapped
	}

	return emoji
}

/**
 * Groups reactions by content/emoji, mapping each reaction to the pubkeys that used it
 * @param reactions - Array of Reaction objects
 * @returns Map where key is content/emoji and value is array of author pubkeys
 */
export const groupReactionsByContent = (reactions: Reaction[]): Map<string, Reaction[]> => {
	const grouped = new Map<string, Reaction[]>()

	reactions.forEach((reaction) => {
		// NOTE: For now, we're not supporting custom/external reactions (e.g. `:zapstore:`).
		// We instead transform custom/external reactions and "+" reactions into "❤️".
		const emoji = normalizeEmoji(reaction.emoji)

		if (!grouped.has(emoji)) {
			grouped.set(emoji, [])
		}

		// Use Set to prevent duplicate reactions from same user
		// Filter out reactions from the same user with the same emoji
		const existingReactions = grouped.get(emoji) || []

		// Note that the efficiency here is pretty bad – O(n^2) – but for small lists it might be better than
		// creating additional data structures.
		const hasSameUserReaction = existingReactions.some((r) => r.authorPubkey === reaction.authorPubkey && r.emoji === emoji)

		if (!hasSameUserReaction) {
			grouped.get(emoji)!.push(reaction)
		}
	})

	return grouped
}

/**
 * Fetches reactions for a specific event (kind 1 text notes)
 * @param targetEvent - The event to fetch reactions for
 * @returns Reactions grouped by reaction content/emoji in map format
 */
export const fetchEventReactions = async (event: NDKEvent): Promise<Map<string, Reaction[]>> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Fetch reactions that reference this specific event
	const filter: NDKFilter = {
		kinds: [REACTION_KIND],
		'#e': [event.id],
		'#k': [event.kind.toString()],
		'#p': [event.pubkey],
		limit: 100,
	}

	const events = await ndk.fetchEvents(filter)
	const reactions = Array.from(events).map(transformReactionEvent)

	// Group reactions by content/emoji
	const groupReactions = groupReactionsByContent(reactions)

	// Sort reaction groups by highest count
	const groupReactionsSorted = new Map(Array.from(groupReactions).sort((a, b) => (a[1].length > b[1].length ? -1 : 1)))

	return groupReactionsSorted
}

// TODO: Similar to the above, but fetch Own-User Event Reactions

/**
 * Hook to fetch reactions for an event
 */
export const useEventReactions = (event: NDKEvent) => {
	return useQuery({
		queryKey: reactionKeys.byEvent(event.id, event.pubkey),
		queryFn: () => fetchEventReactions(event),
		enabled: !!event,
	})
}

// TODO: Similar to the above, but fetch Own-User Event Reactions
