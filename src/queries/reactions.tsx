import { ndkActions } from '@/lib/stores/ndk'
import { reactionKeys } from './queryKeyFactory'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { isAddressableKind } from 'nostr-tools/kinds'

/**
 * NIP-25 Reaction kind
 * Note that this only applies to *Nostr events*.
 * Reactions to external events should be of kind 17.
 * https://github.com/nostr-protocol/nips/blob/master/25.md
 */
const REACTION_KIND = 7
// const REACTION_KIND_EXTERNAL = 17
const DELETION_KIND = 5

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
	targetEvent: NDKEvent
}

const transformReactionEvent = (event: NDKEvent, targetEvent: NDKEvent): Reaction => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw Error('NDK must be initialized.')

	return {
		id: event.id,
		emoji: event.content,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		authorPubkey: event.pubkey,
		targetEvent: targetEvent,
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

export const filterForLatestReactionsOnly = (reactions: Reaction[]): Reaction[] => {
	const reactionsByUserEmoji = new Map<string, Reaction>()

	// Use a concatenation of user, emoji and event to select only the most recent reaction
	reactions.forEach((reaction) => {
		const identifier = reaction.targetEvent.id + reaction.authorPubkey + reaction.emoji
		const existingEntry = reactionsByUserEmoji.get(identifier)

		// If unique pair is most recent, then keep newest version.
		// If no existing entry exists, then also save
		// Else, discard older conflicting entry. (Nothing to do)
		if (!existingEntry || (existingEntry && reaction.createdAt > existingEntry.createdAt)) {
			reactionsByUserEmoji.set(identifier, reaction)
		}
	})

	// Return values of map (unique reactions only)
	return Array.from(reactionsByUserEmoji.values())
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

/** Handles processing for:
 * 1) uniqueness of author - targetEvent - content/emoji. Only keeps latest unique reaction
 * 2) queries for deletion and filters out deleted reactions
 */
const filterReactionsValid = async (reactions: Reaction[]): Promise<Reaction[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const reactionsUnique = filterForLatestReactionsOnly(reactions)

	const filterDeletions: NDKFilter = {
		kinds: [DELETION_KIND],
		'#e': reactionsUnique.map((reaction) => reaction.id),
	}

	const eventsDeletions = await ndk.fetchEvents(filterDeletions)

	// Create O(1)-complexity reference table with all deleted reaction IDs
	const idsReactionsDeleted = new Set<string>()
	Array.from(eventsDeletions)
		.flatMap((e) => e.tags.filter((t) => t[0] === 'e'))
		.map((t) => t?.[1])
		.forEach((id) => idsReactionsDeleted.add(id))

	// Filter by checking if reaction has been deleted
	return reactionsUnique.filter((reaction) => !idsReactionsDeleted.has(reaction.id))
}

/**
 * Fetches reactions for a specific event (kind 1 text notes)
 * @param targetEvent - The event to fetch reactions for
 * @returns Reactions grouped by reaction content/emoji in map format
 */
export const fetchEventReactions = async (event: NDKEvent): Promise<Reaction[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Fetch reactions that reference this specific event
	const filter: NDKFilter = {
		kinds: [REACTION_KIND],
		'#k': [event.kind.toString()],
		'#p': [event.pubkey],
		limit: 100,
	}

	if (isAddressableKind(event.kind)) {
		const address = event.tagAddress()

		filter['#a'] = [address]
	} else {
		filter['#e'] = [event.id]
	}

	const events = await ndk.fetchEvents(filter)
	const reactions = Array.from(events).map((e) => transformReactionEvent(e, event))

	// Filter out deleted reactions
	const reactionsFiltered = await filterReactionsValid(reactions)

	// Sort by latest first
	return reactionsFiltered.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
}

export const sortReactionsIntoGroups = (reactions: Reaction[]): Map<string, Reaction[]> => {
	// Group reactions by content/emoji
	const groupReactions = groupReactionsByContent(reactions)

	// Sort reaction groups by highest count first
	return new Map(Array.from(groupReactions).sort((a, b) => (a[1].length > b[1].length ? -1 : 1)))
}

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
