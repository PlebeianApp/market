import type { NDKEvent, NDKFilter, NDKKind } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { configStore } from '@/lib/stores/config'
import { useStore } from '@tanstack/react-store'
import { auctionOracleKeys } from './queryKeyFactory'

/**
 * Auction path-oracle directory.
 *
 * Implements the bidder/seller-side discovery story for the
 * `english_auction_path_oracle_v1` ContextVM tool family. Servers that
 * implement the family announce themselves under CEP-15 with two
 * addressable events:
 *
 *   - kind 11316 (`SERVER_ANNOUNCEMENT_KIND`) — server identity
 *     (`name`, `about`, `website`, `picture`).
 *   - kind 11317 (`TOOLS_LIST_KIND`)         — tool inventory. The
 *     `withCommonToolSchemas` decorator stamps NIP-73 `i` tags of the
 *     form `['i', '<schemaHash>', '<toolName>']` plus a single
 *     `['k', 'io.contextvm/common-schema']` discriminator.
 *
 * We discover by filtering kind 11317 on `#k = io.contextvm/common-schema`,
 * then accepting any event whose `i` tag list mentions one of the four
 * auction tool names. That gives us the set of pubkeys claiming to host
 * the auction tool family. We then fetch matching kind-11316 events to
 * enrich each row with a name / about / website / picture for the UI.
 *
 * The directory always includes the app's configured "default" oracle
 * (`configStore.config.cvmServerPubkey`) so that the form has a usable
 * pre-selection even when no announcement has been observed yet (e.g. on
 * a fresh dev relay before the CVM server has finished publishing). If
 * the configured pubkey turns out to also be in the discovered set, the
 * two records merge (announcement metadata wins for display fields).
 */

// CEP-15 announcement kinds (mirrored from `@contextvm/sdk` core/constants —
// hard-coded to keep the React bundle off the SDK, which pulls in pino).
// Cast through `NDKKind` so the literal numbers slot into NDK's generic
// `kinds` filter type without requiring an `as` at every call site.
const SERVER_ANNOUNCEMENT_KIND = 11316 as NDKKind
const TOOLS_LIST_KIND = 11317 as NDKKind

// CEP-15 common-schema discriminator written by `withCommonToolSchemas`.
const COMMON_SCHEMA_META_NAMESPACE = 'io.contextvm/common-schema'

// Auction tool names. Duplicated from `contextvm/auction-schemas.ts` to
// avoid pulling server-side modules into the React bundle. These strings
// are part of the CEP-15 schema-hash input, so changing them is a
// breaking protocol bump — duplication risk is acceptable.
const AUCTION_TOOL_NAMES = ['request_path', 'submit_bid_token', 'request_settlement', 'get_auction_state'] as const
type AuctionToolName = (typeof AUCTION_TOOL_NAMES)[number]

const AUCTION_TOOL_NAME_SET = new Set<string>(AUCTION_TOOL_NAMES)

const DISCOVERY_FETCH_TIMEOUT_MS = 6_000

export interface AuctionOracleRecord {
	/** Hex pubkey of the server. Goes into the auction's `path_issuer` tag. */
	pubkey: string
	/** Tool names this server is announcing under the auction family. */
	tools: AuctionToolName[]
	/** When the tools-list announcement was last seen on the relay. */
	announcedAt: number
	/** Display name (kind 11316 `name` tag) — falls back to short pubkey. */
	name?: string
	about?: string
	website?: string
	picture?: string
	/**
	 * `'configured'` for the app's hard-coded default oracle when no
	 * matching kind-11317 announcement was seen, `'announced'` for any
	 * server we picked up via discovery (with or without overlap with
	 * the configured pubkey).
	 */
	source: 'configured' | 'announced'
}

const truncatePubkey = (pubkey: string): string => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`

const collectAuctionToolsFromTags = (event: NDKEvent): AuctionToolName[] => {
	const found = new Set<AuctionToolName>()
	for (const tag of event.tags) {
		if (tag[0] !== 'i') continue
		// `['i', schemaHash, toolName]` — toolName is the third element.
		const toolName = tag[2]
		if (typeof toolName !== 'string') continue
		if (AUCTION_TOOL_NAME_SET.has(toolName)) {
			found.add(toolName as AuctionToolName)
		}
	}
	return Array.from(found)
}

const readTag = (event: NDKEvent | undefined, tagName: string): string | undefined => {
	if (!event) return undefined
	const tag = event.tags.find((t) => t[0] === tagName)
	const value = tag?.[1]
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Fetch the set of servers announcing the auction tool family.
 *
 * Two sequential relay round-trips: first kind 11317 (with the
 * common-schema discriminator), then kind 11316 for the matching
 * authors. Both are bounded by `DISCOVERY_FETCH_TIMEOUT_MS` so the form
 * never hangs the publish flow waiting on a missing relay.
 */
export const fetchAuctionOracleDirectory = async (defaultPubkey: string | undefined): Promise<AuctionOracleRecord[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		// Without NDK we still surface the configured default so the form
		// can submit. The selector UI shows it as 'configured'.
		return defaultPubkey ? [buildConfiguredFallback(defaultPubkey)] : []
	}

	const toolsListFilter: NDKFilter = {
		kinds: [TOOLS_LIST_KIND],
		'#k': [COMMON_SCHEMA_META_NAMESPACE],
		limit: 200,
	}

	const toolsListEvents = Array.from(await ndkActions.fetchEventsWithTimeout(toolsListFilter, { timeoutMs: DISCOVERY_FETCH_TIMEOUT_MS }))

	// Group by author. Multiple kind-11317s per author are possible if the
	// server has been re-announced; latest wins.
	const latestToolsByPubkey = new Map<string, NDKEvent>()
	for (const event of toolsListEvents) {
		const tools = collectAuctionToolsFromTags(event)
		if (tools.length === 0) continue
		const existing = latestToolsByPubkey.get(event.pubkey)
		if (!existing || (event.created_at || 0) > (existing.created_at || 0)) {
			latestToolsByPubkey.set(event.pubkey, event)
		}
	}

	const announcedPubkeys = Array.from(latestToolsByPubkey.keys())

	// Enrich with kind-11316 server-info announcements. This is best-effort —
	// the directory is still usable (just less pretty) if these are missing.
	let serverAnnouncementByPubkey = new Map<string, NDKEvent>()
	if (announcedPubkeys.length > 0) {
		const serverAnnouncementFilter: NDKFilter = {
			kinds: [SERVER_ANNOUNCEMENT_KIND],
			authors: announcedPubkeys,
			limit: announcedPubkeys.length * 2,
		}
		const serverAnnouncementEvents = Array.from(
			await ndkActions.fetchEventsWithTimeout(serverAnnouncementFilter, { timeoutMs: DISCOVERY_FETCH_TIMEOUT_MS }),
		)
		serverAnnouncementByPubkey = new Map<string, NDKEvent>()
		for (const event of serverAnnouncementEvents) {
			const existing = serverAnnouncementByPubkey.get(event.pubkey)
			if (!existing || (event.created_at || 0) > (existing.created_at || 0)) {
				serverAnnouncementByPubkey.set(event.pubkey, event)
			}
		}
	}

	const records: AuctionOracleRecord[] = []
	for (const [pubkey, toolsListEvent] of Array.from(latestToolsByPubkey.entries())) {
		const serverAnnouncement = serverAnnouncementByPubkey.get(pubkey)
		records.push({
			pubkey,
			tools: collectAuctionToolsFromTags(toolsListEvent),
			announcedAt: toolsListEvent.created_at || 0,
			name: readTag(serverAnnouncement, 'name'),
			about: readTag(serverAnnouncement, 'about'),
			website: readTag(serverAnnouncement, 'website'),
			picture: readTag(serverAnnouncement, 'picture'),
			source: 'announced',
		})
	}

	// Always surface the configured default — even if no announcement was
	// seen for it. If discovery already returned a row for the same
	// pubkey, leave the announced record (it has fresher metadata).
	if (defaultPubkey && !records.some((record) => record.pubkey === defaultPubkey)) {
		records.unshift(buildConfiguredFallback(defaultPubkey))
	}

	// Sort: announced first (most recent first), then any configured-only
	// fallback at the end. Keeps the dropdown stable across reloads while
	// surfacing live oracles ahead of static config.
	records.sort((a, b) => {
		if (a.source !== b.source) return a.source === 'announced' ? -1 : 1
		return b.announcedAt - a.announcedAt
	})

	return records
}

const buildConfiguredFallback = (pubkey: string): AuctionOracleRecord => ({
	pubkey,
	tools: [],
	announcedAt: 0,
	name: 'Default oracle',
	about: 'Configured via app settings — no live CEP-15 announcement seen on this relay yet.',
	source: 'configured',
})

export const auctionOracleDirectoryQueryOptions = (defaultPubkey: string | undefined) =>
	queryOptions({
		queryKey: auctionOracleKeys.directory(),
		queryFn: () => fetchAuctionOracleDirectory(defaultPubkey),
		staleTime: 30_000,
		retry: 1,
	})

/**
 * React hook for the auction-creation form's oracle picker. Returns the
 * configured default pubkey alongside the discovered set so the form can
 * pre-select something safe before discovery resolves.
 */
export const useAuctionOracleDirectory = () => {
	const defaultPubkey = useStore(configStore, (state) => state.config.cvmServerPubkey?.trim() || undefined)
	const query = useQuery(auctionOracleDirectoryQueryOptions(defaultPubkey))
	return {
		...query,
		defaultPubkey,
	}
}

/** UI helper: a short, fixed-width display label for an oracle row. */
export const formatAuctionOracleLabel = (record: AuctionOracleRecord): string => {
	if (record.name && record.name.trim().length > 0) return record.name
	return truncatePubkey(record.pubkey)
}
