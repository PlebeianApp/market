import { fetchEvents } from '@/lib/nostr/io'
import type { NostrEvent } from '@/lib/nostr/io'
import {
	STOREFRONT_PAGE_D_TAG,
	STOREFRONT_PAGE_KIND,
	parseStorefrontPage,
	type StorefrontPage,
	type StorefrontParseResult,
} from '@/lib/schemas/storefront'
import { publishStorefrontPage } from '@/publish/storefront-page'
import { isValidHexKey } from '@/lib/utils'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { storefrontKeys } from './queryKeyFactory'

/**
 * Reading storefront page documents (kind 30024, `d=storefront-page`).
 *
 * The page is user-authored content fetched from relays, so it is untrusted
 * until `parseStorefrontPage` accepts it (`src/queries/AGENTS.md`). This module
 * therefore returns a *result*, not a page: callers need to tell apart "this
 * author has no page" from "this author has a page we could not read", because
 * those lead to different UI — the first is the ordinary profile view, the
 * second is the profile view plus a notice the author can act on.
 */

export interface StorefrontPageResult extends StorefrontParseResult {
	/** Null when the author has never published a page. */
	event: NostrEvent | null
	/** The document's author, present whenever `event` is. */
	pubkey: string | null
}

const EMPTY_RESULT: StorefrontPageResult = { event: null, pubkey: null, page: null, droppedBlocks: 0, error: null }

/**
 * Picks the winning event for an addressable coordinate.
 *
 * NIP-01: highest `created_at` wins; ties break on the lexicographically
 * smallest id. Relays are not required to return only the newest replacement,
 * and a misbehaving one can return several, so the choice is made here rather
 * than trusting arrival order.
 */
function selectReplaceable(events: NostrEvent[]): NostrEvent | null {
	let winner: NostrEvent | null = null
	for (const event of events) {
		if (!winner) {
			winner = event
			continue
		}
		if (event.created_at > winner.created_at) {
			winner = event
			continue
		}
		if (event.created_at === winner.created_at && event.id < winner.id) {
			winner = event
		}
	}
	return winner
}

/**
 * Fetches and validates one author's storefront page.
 *
 * Returns the empty result for an author who has no page. Relay/transport
 * failures are allowed to reject so React Query reports `isError` and keeps any
 * previously cached page, rather than committing a null-shaped success that
 * would flash the profile fallback over a page that does exist.
 */
export async function fetchStorefrontPage(pubkey: string): Promise<StorefrontPageResult> {
	if (!isValidHexKey(pubkey)) return EMPTY_RESULT

	const events = await fetchEvents({
		kinds: [STOREFRONT_PAGE_KIND],
		authors: [pubkey],
		'#d': [STOREFRONT_PAGE_D_TAG],
	})

	// Defence in depth: a relay may answer a filter with events that do not
	// match it. Author and `d` decide the address, so re-check both rather than
	// rendering whatever came back.
	const addressed = events.filter(
		(event) =>
			event.kind === STOREFRONT_PAGE_KIND &&
			event.pubkey === pubkey &&
			event.tags.some((tag) => tag[0] === 'd' && tag[1] === STOREFRONT_PAGE_D_TAG),
	)

	const event = selectReplaceable(addressed)
	if (!event) return EMPTY_RESULT

	const parsed = parseStorefrontPage(event.content)
	return { event, pubkey: event.pubkey, ...parsed }
}

export const storefrontPageQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: storefrontKeys.page(pubkey),
		queryFn: () => fetchStorefrontPage(pubkey),
		enabled: isValidHexKey(pubkey),
		// Pages change rarely and sit on the critical path of every profile
		// view, so a generous stale window avoids a relay round trip per visit.
		staleTime: 2 * 60 * 1000,
	})

/** One author's storefront page. `pubkey` must be hex; resolve npub/NIP-05 first. */
export function useStorefrontPage(pubkey: string | undefined) {
	return useQuery(storefrontPageQueryOptions(pubkey ?? ''))
}

/**
 * True when this author's page should replace the default profile view.
 *
 * Both conditions matter: the document must have parsed, and the author must
 * have switched it on. A page that parsed to zero surviving blocks is also
 * refused — an empty page is worse for a visitor than the profile they expected.
 */
export function shouldRenderStorefrontPage(result: StorefrontPageResult | undefined): result is StorefrontPageResult & {
	page: StorefrontPage
} {
	return Boolean(result?.page?.enabled && result.page.content.length > 0)
}

/**
 * Publishes the author's own page and refreshes their cached copy.
 *
 * Invalidation is a cache hint, not proof of relay retention
 * (`src/publish/AGENTS.md`): the mutation result carries the relays that
 * actually ACKed, and the UI reports from that.
 */
export function usePublishStorefrontPage() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (page: StorefrontPage) => publishStorefrontPage(page),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: storefrontKeys.page(result.pubkey) })
		},
	})
}
