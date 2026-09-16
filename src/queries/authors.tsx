import { authorKeys } from './queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { isValidHexKey } from '@/lib/utils'
import { createAuthorRelayReadDeps, readAuthorScopedEvents } from '@/lib/nostr/authorRelayRead'
import { NDKEvent, type NDKFilter } from '@/lib/nostr/ndk-events'
import { fetchUserRelayListWithPreferences } from './relay-list'

export type NostrAuthor = {
	id: string
	name?: string
	about?: string
	picture?: string
	nip05?: string
}

/**
 * Parse kind-0 content defensively: relay-supplied metadata is untrusted and
 * may be absent, empty, or not JSON at all.
 */
const parseProfileContent = (content: string | undefined): Record<string, unknown> => {
	if (!content) return {}
	try {
		const parsed: unknown = JSON.parse(content)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
	} catch {
		return {}
	}
}

const transformEvent = (event: NDKEvent): NostrAuthor => {
	const content = parseProfileContent(event.content)
	const nameTag = event.tags.find((t) => t[0] === 'name')?.[1]

	return {
		id: event.pubkey,
		name: nameTag || (typeof content.name === 'string' ? content.name : undefined),
		about: typeof content.about === 'string' ? content.about : undefined,
		picture: typeof content.picture === 'string' ? content.picture : undefined,
		nip05: typeof content.nip05 === 'string' ? content.nip05 : undefined,
	}
}

export const fetchAuthor = async (pubkey: string) => {
	// Reject an invalid pubkey before constructing the filter — a malformed
	// value in { authors: [...] } trips NDK's strict filter validation.
	if (!isValidHexKey(pubkey)) throw new Error('Author pubkey is required')

	const filter: NDKFilter = {
		kinds: [0], // kind 0 is metadata
		authors: [pubkey],
	}

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// ADR-0002 F3 (proposed: PR #1333): the pinned read is canonical. A profile that exists only on
	// the author's own declared relay is resolved through the bounded
	// author-relay path (display-only, capped, session-bounded) instead of the
	// outbox model. When that path is off, this stays a pinned-only read.
	const { events } = await readAuthorScopedEvents(
		filter,
		{ authorPubkey: pubkey, purpose: 'display' },
		createAuthorRelayReadDeps({ ndk, fetchAuthorRelayList: fetchUserRelayListWithPreferences }),
	)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		throw new Error('Author not found')
	}

	// Get the most recent metadata event
	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
	return transformEvent(latestEvent)
}

export const authorQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: authorKeys.details(pubkey),
		queryFn: () => fetchAuthor(pubkey),
		enabled: isValidHexKey(pubkey),
	})
