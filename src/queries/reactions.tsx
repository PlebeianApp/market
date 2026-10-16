import { ndkActions } from '@/lib/stores/ndk'
import { reactionKeys } from './queryKeyFactory'
import { useQuery } from '@tanstack/react-query'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	buildReactionDeletionFilter,
	buildReactionFilter,
	collectDeletedEventIds,
	filterForLatestReactionsOnly as filterForLatestReactionsOnlySdk,
	groupReactionsByContent as groupReactionsByContentSdk,
	parseReaction,
	removeDeletedReactions,
	sortReactionsIntoGroups as sortReactionsIntoGroupsSdk,
	sortReactionsNewestFirst,
	type ReactionRecord,
} from '@sdk/commerce/messaging'

export type Reaction = ReactionRecord<NDKEvent>

const transformReactionEvent = (event: NDKEvent, targetEvent: NDKEvent): Reaction => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw Error('NDK must be initialized.')

	return parseReaction(event, targetEvent)
}

export const filterForLatestReactionsOnly = (reactions: Reaction[]): Reaction[] => filterForLatestReactionsOnlySdk(reactions)

export const groupReactionsByContent = (reactions: Reaction[]): Map<string, Reaction[]> => groupReactionsByContentSdk(reactions)

/** Keeps the latest reaction per author/target/emoji, then drops reactions with a NIP-09 deletion. */
const filterReactionsValid = async (reactions: Reaction[]): Promise<Reaction[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const reactionsUnique = filterForLatestReactionsOnly(reactions)
	const eventsDeletions = await ndk.fetchEvents(buildReactionDeletionFilter(reactionsUnique.map((reaction) => reaction.id)))

	return removeDeletedReactions(reactionsUnique, collectDeletedEventIds(eventsDeletions))
}

/**
 * Fetches reactions for a specific event (kind 1 text notes)
 * @param targetEvent - The event to fetch reactions for
 * @returns Reactions grouped by reaction content/emoji in map format
 */
export const fetchEventReactions = async (event: NDKEvent): Promise<Reaction[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents(buildReactionFilter(event))
	const reactions = Array.from(events).map((e) => transformReactionEvent(e, event))

	const reactionsFiltered = await filterReactionsValid(reactions)

	return sortReactionsNewestFirst(reactionsFiltered)
}

export const sortReactionsIntoGroups = (reactions: Reaction[]): Map<string, Reaction[]> => sortReactionsIntoGroupsSdk(reactions)

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
