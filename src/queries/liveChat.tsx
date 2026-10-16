import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { verifyNostrEventSignature } from '@/lib/nostr/event-signature'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { liveActivityKeys } from './queryKeyFactory'
import {
	AUCTION_KIND,
	buildLiveActivityDTag,
	parseLiveActivity,
	parseLiveChatMessage,
	type LiveActivity,
	type LiveChatMessage,
} from '@/lib/nip53'
import {
	buildLiveActivityFilter,
	buildLiveChatMessagesFilter,
	getLiveActivityCandidateRejection,
	sortLiveActivityCandidates,
	sortLiveChatMessages,
} from '@sdk/commerce/messaging'
import { getAuctionId } from './auctions'
import { configStore } from '@/lib/stores/config'

export const fetchLiveActivity = async (event: NDKEvent): Promise<LiveActivity | null> => {
	const dTag = getAuctionId(event)
	if (!dTag) return null

	const ndk = ndkActions.getNDK()
	if (!ndk) return null

	const coord = `${AUCTION_KIND}:${event.pubkey}:${dTag}`

	// The kind-30311 live-activity event's canonical `d` tag is derived from the
	// auction coordinate via buildLiveActivityDTag (`auction:<12-hex digest>`),
	// NOT the auction's bare `d` and not the retired
	// `auction:<seller-prefix>:<auction-d>` form. The digest keeps the activity's
	// own coordinate inside the relay tag-index budget, so the `a` value chat
	// messages carry is actually indexable — filtering on the bare `d` makes a
	// conforming relay return zero events even when the activity exists.
	const expectedActivityD = buildLiveActivityDTag(coord)

	// Fail closed: only accept live activity events from the expected CVM server.
	// The integrated boot path requires this identity before rendering the app.
	const cvmServerPubkey = configStore.state.config.cvmServerPubkey
	if (!cvmServerPubkey) {
		console.warn('fetchLiveActivity: cvmServerPubkey not configured — skipping live activity fetch')
		return null
	}

	// Include #d filter (on the derived live-activity d) to reduce noise and help
	// NDK dedup select the right replacement candidate before we even see the results.
	const expected = { cvmServerPubkey, expectedActivityD }
	const filter = buildLiveActivityFilter(coord, expected)

	const events = await ndkActions.fetchEventsWithTimeout([filter], { timeoutMs: 5000 })
	if (events.size === 0) return null

	const sorted = sortLiveActivityCandidates(events)

	// Belt-and-suspenders: relays or subscriptions may return events outside the
	// requested author set. Scan the full sorted array and return the first event
	// that passes all validation checks, so one misbehaving relay cannot suppress
	// status by injecting an invalid event at sorted[0].
	for (const candidate of sorted) {
		// The candidate's exact d tag must equal the derived live-activity d —
		// not merely be defined — so events for other auctions (or the auction's
		// bare d) can never be accepted as this auction's live activity.
		const rejection = getLiveActivityCandidateRejection(candidate, expected)
		if (rejection?.reason === 'author') {
			console.warn('fetchLiveActivity: skipping live activity event from unexpected author', rejection.value.slice(0, 16))
			continue
		}
		if (rejection?.reason === 'kind') {
			console.warn('fetchLiveActivity: skipping event with unexpected kind', rejection.value)
			continue
		}
		if (rejection?.reason === 'd-tag') {
			console.warn('fetchLiveActivity: skipping live activity event with unexpected d tag', rejection.value)
			continue
		}

		// Verify the Schnorr signature on the event to reject forged events
		// that have the correct pubkey/kind/d-tag but an invalid signature.
		// NDK's sampling verification may skip forged events, so we verify
		// explicitly before accepting the event as valid.
		const raw = candidate.rawEvent?.() ?? candidate
		if (!verifyNostrEventSignature(raw as Parameters<typeof verifyNostrEventSignature>[0])) {
			console.warn('fetchLiveActivity: skipping live activity event with invalid signature', candidate.id?.slice(0, 16))
			continue
		}

		return parseLiveActivity(candidate)
	}

	// No events passed validation
	console.warn('fetchLiveActivity: no valid live activity events found after scanning', sorted.length, 'candidates')
	return null
}

export const fetchLiveChatMessages = async (liveActivityCoord: string): Promise<LiveChatMessage[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const events = await ndkActions.fetchEventsWithTimeout([buildLiveChatMessagesFilter(liveActivityCoord)], { timeoutMs: 5000 })
	return sortLiveChatMessages(Array.from(events).map(parseLiveChatMessage))
}

export interface UseLiveActivityOptions {
	refetchInterval?: number
}

export const useLiveActivity = (event: NDKEvent | null, options?: UseLiveActivityOptions) => {
	const dTag = event ? getAuctionId(event) : ''
	const coord = event && dTag ? `${AUCTION_KIND}:${event.pubkey}:${dTag}` : ''

	return useQuery(
		queryOptions({
			queryKey: liveActivityKeys.byCoord(coord),
			queryFn: () => (event ? fetchLiveActivity(event) : null),
			enabled: !!event && !!dTag,
			refetchInterval: options?.refetchInterval ?? 60_000,
		}),
	)
}

export const useLiveChatMessages = (liveActivityCoord: string, isActive: boolean) => {
	return useQuery(
		queryOptions({
			queryKey: liveActivityKeys.chatMessages(liveActivityCoord),
			queryFn: () => fetchLiveChatMessages(liveActivityCoord),
			enabled: !!liveActivityCoord,
			refetchInterval: isActive ? 3_000 : 15_000,
		}),
	)
}
