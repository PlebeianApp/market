/**
 * Server-side product lookup for social preview (og:) meta injection.
 *
 * When a crawler or link-unfurler requests /products/:productId, the server
 * needs the product's kind 30402 event to render og: tags into the initial
 * HTML. This module fetches that event from the app relay (APP_RELAY_URL —
 * the same relay the server already talks to for invoices and publishing, so
 * no new egress destination), verifies its signature, derives preview meta,
 * and caches the result briefly so repeated crawler hits do not re-query.
 *
 * Multi-relay fallback: if the primary relay (APP_RELAY_URL) is unreachable or
 * times out, the lookup falls through to fallback relays (APP_FALLBACK_RELAYS
 * env, then a small default list of well-known Nostr relays). If ALL relays
 * fail, null is returned and the caller serves the untouched SPA shell —
 * graceful degradation, because this feature is SEO-only and must never break
 * the production app.
 *
 * Every entry point here is best-effort: on any failure (relay down, timeout,
 * unknown id, bad signature) it returns null and the caller serves the
 * untouched SPA shell. A crawler-friendly page must never hang or 5xx.
 */
import { Relay } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools/pure'
import { buildOgProductMeta, type OgProductMeta, type OgTagSourceEvent } from '../lib/ogTags'

/** Hard budget for connect + REQ per relay. Crawlers won't wait much longer anyway. */
const OG_FETCH_TIMEOUT_MS = 2_500
/** Cache TTL for successful and negative lookups. */
const OG_CACHE_TTL_MS = 5 * 60 * 1000
/** Bounds memory; product ids are 64 hex chars so entries are tiny. */
const OG_CACHE_MAX_ENTRIES = 128

const PRODUCT_KIND = 30_402
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/

/**
 * Default fallback relays used when APP_RELAY_URL is unset and no
 * APP_FALLBACK_RELAYS are configured. These are well-known, high-uptime
 * Nostr relays that commonly carry NIP-15 marketplace events.
 */
const DEFAULT_FALLBACK_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

interface OgCacheEntry {
	meta: OgProductMeta | null
	expiresAt: number
}

const ogMetaCache = new Map<string, OgCacheEntry>()

/**
 * Build an ordered, de-duplicated relay list for product lookups.
 *
 * Order: (1) primary relay (APP_RELAY_URL), (2) env-configured fallbacks
 * (APP_FALLBACK_RELAYS, comma-separated), (3) default well-known relays.
 * Duplicates are removed so a relay appearing in multiple positions is only
 * tried once.
 *
 * @param primaryRelay - APP_RELAY_URL value (may be undefined)
 * @param fallbackRelaysEnv - APP_FALLBACK_RELAYS value (comma-separated, may be undefined)
 * @returns ordered array of unique relay URLs
 */
export function buildRelayList(primaryRelay: string | undefined, fallbackRelaysEnv: string | undefined): string[] {
	const relays: string[] = []
	const seen = new Set<string>()

	function addIfValid(url: string | undefined) {
		const trimmed = url?.trim()
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed)
			relays.push(trimmed)
		}
	}

	// (a) Primary relay first
	addIfValid(primaryRelay)

	// (b) Env-configured fallbacks
	if (fallbackRelaysEnv) {
		for (const url of fallbackRelaysEnv.split(',')) {
			addIfValid(url)
		}
	}

	// (c) Default well-known relays
	for (const url of DEFAULT_FALLBACK_RELAYS) {
		addIfValid(url)
	}

	return relays
}

/**
 * Try relays in order, calling `fetchFn` for each until one returns a non-null
 * result. If all relays fail (return null), returns null — graceful degradation.
 *
 * @param relayUrls - ordered list of relay URLs to try
 * @param fetchFn - function that attempts to fetch a verified product event from a single relay
 * @returns the first non-null event, or null if all relays fail
 */
export async function tryRelaysInOrder(
	relayUrls: string[],
	fetchFn: (relayUrl: string) => Promise<unknown | null>,
): Promise<unknown | null> {
	for (const url of relayUrls) {
		try {
			const event = await fetchFn(url)
			if (event) return event
		} catch (error) {
			console.warn('og: relay lookup failed for', url, ':', error instanceof Error ? error.message : String(error))
		}
	}
	return null
}

/**
 * Fetch (or recall from cache) preview meta for a product id. Returns null
 * for non-event-id inputs, NSFW products, and any lookup failure (all relays
 * down). The caller serves the untouched SPA shell when null is returned.
 *
 * @param relayUrl - primary relay URL (APP_RELAY_URL, may be undefined)
 * @param productId - 64-hex-char Nostr event id
 * @param fallbackRelaysEnv - optional comma-separated fallback relay list from env (APP_FALLBACK_RELAYS)
 */
export async function getProductOgMeta(
	relayUrl: string | undefined,
	productId: string,
	fallbackRelaysEnv?: string,
): Promise<OgProductMeta | null> {
	const id = productId.trim().toLowerCase()
	if (!EVENT_ID_PATTERN.test(id)) return null

	// Build the full relay list: primary → env fallbacks → defaults
	const relayList = buildRelayList(relayUrl, fallbackRelaysEnv)
	if (relayList.length === 0) return null

	const cached = ogMetaCache.get(id)
	if (cached && cached.expiresAt > Date.now()) return cached.meta

	const event = await tryRelaysInOrder(relayList, (url) => fetchVerifiedProductEvent(url, id))
	const meta = event ? buildOgProductMeta(event as unknown as OgTagSourceEvent) : null

	ogMetaCache.set(id, { meta, expiresAt: Date.now() + OG_CACHE_TTL_MS })
	if (ogMetaCache.size > OG_CACHE_MAX_ENTRIES) {
		// Map preserves insertion order: drop the oldest entry.
		const oldest = ogMetaCache.keys().next().value
		if (oldest !== undefined) ogMetaCache.delete(oldest)
	}

	return meta
}

/**
 * Connect to the relay, REQ the single product event, and return it only if
 * its signature verifies. Relay data is untrusted input: an event that fails
 * verification is discarded rather than rendered into HTML.
 */
async function fetchVerifiedProductEvent(relayUrl: string, productId: string): Promise<unknown | null> {
	let relay: Relay | null = null
	try {
		const deadline = Date.now() + OG_FETCH_TIMEOUT_MS

		relay = await Promise.race([Relay.connect(relayUrl), rejectAfter(OG_FETCH_TIMEOUT_MS, 'og: relay connect timeout')])

		return await Promise.race([
			requestProductEvent(relay, productId),
			rejectAfter(Math.max(deadline - Date.now(), 1), 'og: relay request timeout'),
		])
	} catch (error) {
		// Best-effort by contract: any failure means "no preview meta".
		console.warn('og: product lookup failed:', error instanceof Error ? error.message : String(error))
		return null
	} finally {
		try {
			relay?.close()
		} catch {
			// Connection may already be closed.
		}
	}
}

/** Subscribe with an ids filter, resolve on the first verified event or EOSE. */
function requestProductEvent(relay: Relay, productId: string): Promise<unknown | null> {
	return new Promise((resolve) => {
		let settled = false

		const sub = relay.subscribe(
			[
				{
					ids: [productId],
					kinds: [PRODUCT_KIND],
					limit: 1,
				},
			],
			{
				onevent: (event) => {
					if (!verifyEvent(event)) return // untrusted relay data: discard
					settle(event)
				},
				oneose: () => settle(null),
				onclose: () => settle(null),
			},
		)

		function settle(value: unknown | null) {
			if (settled) return
			settled = true
			try {
				sub.close()
			} catch {
				// Subscription may already be closed.
			}
			resolve(value)
		}
	})
}

function rejectAfter(ms: number, message: string): Promise<never> {
	return new Promise((_, reject) => {
		setTimeout(() => reject(new Error(message)), ms)
	})
}
