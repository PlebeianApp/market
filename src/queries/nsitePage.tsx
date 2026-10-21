import { fetchEvents } from '@/lib/nostr/io'
import type { NostrEvent } from '@/lib/nostr/io'
import { NSITE_PAGE_KIND, parseNsitePageEvent, type NsitePage } from '@/lib/schemas/nsitePage'
import { queryOptions, useQuery } from '@tanstack/react-query'

/**
 * Reading nsite static pages (kind 34128) published by an external CMS.
 *
 * This is the read half of the nsite interop added alongside
 * `src/lib/schemas/nsitePage.ts`. It is a *foreign* read: these events are
 * authored by other applications (notably `bitkarrot/nostr-cms`), so nothing
 * here assumes our own shape, and the parser — not the query — decides what
 * counts as a page.
 *
 * Two deliberate limitations, both of which a caller has to see:
 *
 *  - **The newest event per (author, path) wins**, by `created_at`, with the
 *    lowest id breaking ties. That is the same replaceable-event rule the
 *    storefront reader uses, and it matters here for the same reason: a relay
 *    is free to serve several versions at once.
 *
 *  - **A page body is never rendered by this module.** It returns the text and
 *    the digest; what may be shown, and how, is the caller's decision. The
 *    blob is *not* fetched here either — that would be network egress on a read
 *    path, and it belongs behind an explicit action by whoever renders it. Use
 *    `fetchBlossomBlob` from `src/lib/blossom.ts` when you want those bytes,
 *    which verifies them against the digest before returning.
 */

export const nsitePageKeys = {
	all: ['nsite-page'] as const,
	byPath: (path: string, author?: string) => ['nsite-page', author ?? 'any', path] as const,
}

export interface NsitePageReadResult {
	page: NsitePage | null
	/** Events that were the right kind but carried no usable page. */
	rejected: number
	/** Parse warnings from the page that won. */
	warnings: string[]
	/** Set when the read itself failed, as distinct from "no page exists". */
	error: string | null
}

/**
 * Reads the newest nsite page at a path.
 *
 * Returns a discriminated outcome rather than `null`, because "this path has no
 * page" and "the relay could not be reached" are different facts and a visitor
 * who sees a 404 deserves to know which one happened.
 */
export async function fetchNsitePage(path: string, options: { author?: string } = {}): Promise<NsitePageReadResult> {
	const empty: NsitePageReadResult = { page: null, rejected: 0, warnings: [], error: null }

	try {
		const events = (await fetchEvents({ kinds: [NSITE_PAGE_KIND], '#d': [path] })) as unknown
		const list: NostrEvent[] = Array.isArray(events) ? (events as NostrEvent[]) : Array.from((events as Iterable<NostrEvent>) ?? [])

		const candidates = list
			.filter((event) => event?.kind === NSITE_PAGE_KIND)
			.filter((event) => !options.author || event.pubkey === options.author)
			// Newest first, ties on lowest id — the addressable-event rule.
			.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

		let rejected = 0
		for (const candidate of candidates) {
			const { page, error, warnings } = parseNsitePageEvent(candidate)
			if (page) return { page, rejected, warnings, error: null }
			if (error) rejected += 1
		}

		return { ...empty, rejected }
	} catch (error) {
		return { ...empty, error: error instanceof Error ? error.message : 'Could not read from the relay' }
	}
}

export function nsitePageQueryOptions(path: string, options: { author?: string } = {}) {
	return queryOptions({
		queryKey: nsitePageKeys.byPath(path, options.author),
		queryFn: () => fetchNsitePage(path, options),
		staleTime: 60_000,
	})
}

export function useNsitePage(path: string, options: { author?: string } = {}) {
	return useQuery(nsitePageQueryOptions(path, options))
}
