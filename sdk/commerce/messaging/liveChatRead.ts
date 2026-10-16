import { LIVE_CHAT_KIND } from './liveChatEvents'

/** NIP-53 live activity kind. */
export const LIVE_ACTIVITY_KIND = 30311

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type LiveChatFilter = {
	kinds: number[]
	authors?: string[]
	'#a'?: string[]
	'#d'?: string[]
	limit?: number
}

export interface LiveActivityCandidate {
	id: string
	pubkey: string
	kind: number
	created_at?: number
	tags?: string[][]
}

export interface ExpectedLiveActivity {
	/** The only author whose live-activity events are accepted. */
	cvmServerPubkey: string
	/** The derived live-activity `d` tag the candidate must carry exactly. */
	expectedActivityD: string
}

export type LiveActivityCandidateRejection =
	| { reason: 'author'; value: string }
	| { reason: 'kind'; value: number }
	| { reason: 'd-tag'; value: string | undefined }

/** Live activities for an auction coordinate, restricted to the trusted author and derived `d`. */
export function buildLiveActivityFilter(auctionCoord: string, expected: ExpectedLiveActivity): LiveChatFilter {
	return {
		kinds: [LIVE_ACTIVITY_KIND],
		authors: [expected.cvmServerPubkey],
		'#a': [auctionCoord],
		'#d': [expected.expectedActivityD],
		limit: 10,
	}
}

export function buildLiveChatMessagesFilter(liveActivityCoord: string): LiveChatFilter {
	return { kinds: [LIVE_CHAT_KIND], '#a': [liveActivityCoord], limit: 200 }
}

/** Newest first by created_at, lexicographically lower id on ties. Returns a new array. */
export function sortLiveActivityCandidates<E extends LiveActivityCandidate>(events: Iterable<E>): E[] {
	return Array.from(events).sort((a, b) => {
		if ((b.created_at ?? 0) !== (a.created_at ?? 0)) return (b.created_at ?? 0) - (a.created_at ?? 0)
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
	})
}

/** First failing author/kind/d-tag check, or null. Signature verification is the caller's job. */
export function getLiveActivityCandidateRejection(
	candidate: LiveActivityCandidate,
	expected: ExpectedLiveActivity,
): LiveActivityCandidateRejection | null {
	if (candidate.pubkey !== expected.cvmServerPubkey) return { reason: 'author', value: candidate.pubkey }
	if (candidate.kind !== LIVE_ACTIVITY_KIND) return { reason: 'kind', value: candidate.kind }
	const candidateD = candidate.tags?.find((t: string[]) => t[0] === 'd')?.[1]
	if (candidateD !== expected.expectedActivityD) return { reason: 'd-tag', value: candidateD }
	return null
}

/** Oldest first; sorts in place. */
export function sortLiveChatMessages<M extends { createdAt: number }>(messages: M[]): M[] {
	return messages.sort((a, b) => a.createdAt - b.createdAt)
}
