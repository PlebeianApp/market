import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import {
	AUCTION_PATH_REGISTRY_KIND,
	extractAuctionPathRegistryEvent,
	getAuctionPathRegistryFilter,
	getAuctionPathRegistryTags,
	parseAuctionPathRegistry,
	type AuctionPathRegistry,
} from '../../lib/auctionPathOracle'
import type { AuctionContext } from './context'

/**
 * Path-oracle registry persistence.
 *
 * Under cashu_p2pk_path_oracle_v1, the issuer holds the mapping from
 * (auction, bid) to the HD derivation path that produced the Cashu
 * lock pubkey. The mapping is persisted on Nostr as a kind 30410 event
 * encrypted to the issuer's own pubkey (NIP-44). A short-lived in-memory
 * cache avoids a relay round-trip per bid but is never authoritative.
 *
 * The cache is keyed by `(issuerPubkey, auctionEventId)` so it's safe
 * across the bun server and the ContextVM server (different signers).
 */

const pathRegistryCache = new Map<string, { registry: AuctionPathRegistry; fetchedAtMs: number }>()
const PATH_REGISTRY_CACHE_TTL_MS = 5_000

const cacheKey = (issuerPubkey: string, auctionEventId: string): string => `${issuerPubkey}:${auctionEventId}`

export async function fetchAuctionPathRegistry(ctx: AuctionContext, auctionEventId: string): Promise<AuctionPathRegistry | null> {
	const key = cacheKey(ctx.issuerPubkey, auctionEventId)
	const cached = pathRegistryCache.get(key)
	if (cached && Date.now() - cached.fetchedAtMs < PATH_REGISTRY_CACHE_TTL_MS) {
		return cached.registry
	}
	const events = Array.from(await ctx.ndk.fetchEvents(getAuctionPathRegistryFilter(auctionEventId, ctx.issuerPubkey)))
	const latest = extractAuctionPathRegistryEvent(events)
	if (!latest) return null
	try {
		const decryptable = new NDKEvent(ctx.ndk, latest.rawEvent())
		await decryptable.decrypt(new NDKUser({ pubkey: ctx.issuerPubkey }), ctx.signer, 'nip44')
		const registry = parseAuctionPathRegistry(decryptable.content)
		if (!registry) return null
		pathRegistryCache.set(key, { registry, fetchedAtMs: Date.now() })
		return registry
	} catch (error) {
		console.error('[auction] Failed to decrypt path registry:', error)
		return null
	}
}

export async function publishAuctionPathRegistry(ctx: AuctionContext, registry: AuctionPathRegistry): Promise<void> {
	const event = new NDKEvent(ctx.ndk)
	event.kind = AUCTION_PATH_REGISTRY_KIND
	event.content = JSON.stringify(registry)
	event.tags = getAuctionPathRegistryTags(registry, ctx.issuerPubkey)
	await event.encrypt(new NDKUser({ pubkey: ctx.issuerPubkey }), ctx.signer, 'nip44')
	await event.sign(ctx.signer)
	await event.publish()
	pathRegistryCache.set(cacheKey(ctx.issuerPubkey, registry.auctionEventId), { registry, fetchedAtMs: Date.now() })
}
