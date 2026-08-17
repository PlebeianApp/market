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
 * Every entry point here is best-effort: on any failure (relay down, timeout,
 * unknown id, bad signature) it returns null and the caller serves the
 * untouched SPA shell. A crawler-friendly page must never hang or 5xx.
 */
import { Relay } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools/pure'
import { buildOgProductMeta, type OgProductMeta, type OgTagSourceEvent } from '../lib/ogTags'

/** Hard budget for connect + REQ. Crawlers won't wait much longer anyway. */
const OG_FETCH_TIMEOUT_MS = 2_500
/** Cache TTL for successful and negative lookups. */
const OG_CACHE_TTL_MS = 5 * 60 * 1000
/** Bounds memory; product ids are 64 hex chars so entries are tiny. */
const OG_CACHE_MAX_ENTRIES = 128

const PRODUCT_KIND = 30_402
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/

interface OgCacheEntry {
	meta: OgProductMeta | null
	expiresAt: number
}

const ogMetaCache = new Map<string, OgCacheEntry>()

/**
 * Fetch (or recall from cache) preview meta for a product id. Returns null
 * for non-event-id inputs, NSFW products, and any lookup failure.
 */
export async function getProductOgMeta(relayUrl: string | undefined, productId: string): Promise<OgProductMeta | null> {
	if (!relayUrl) return null

	const id = productId.trim().toLowerCase()
	if (!EVENT_ID_PATTERN.test(id)) return null

	const cached = ogMetaCache.get(id)
	if (cached && cached.expiresAt > Date.now()) return cached.meta

	const event = await fetchVerifiedProductEvent(relayUrl, id)
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
