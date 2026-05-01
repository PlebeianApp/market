import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import {
	AUCTION_PATH_REGISTRY_KIND,
	extractAuctionPathRegistryEvent,
	getAuctionPathRegistryFilter,
	getAuctionPathRegistryTags,
	parseAuctionPathRegistry,
	type AuctionPathRegistry,
} from '../../lib/auctionPathOracle'
import { ensureInvoiceNdkConnected, getAppAuctionSigner } from '../ndk'
import { getAppPublicKeyOrThrow } from '../runtime'

/**
 * Path-oracle registry persistence.
 *
 * Under cashu_p2pk_path_oracle_v1, the app is the path issuer. It holds the
 * mapping from (auction, bid) to the HD derivation path that produced the
 * Cashu lock pubkey. The mapping is persisted on Nostr as a kind 30410 event
 * encrypted to the app's own pubkey (NIP-44). A short-lived in-memory cache
 * avoids a relay round-trip per bid but is never authoritative.
 */

const pathRegistryCache = new Map<string, { registry: AuctionPathRegistry; fetchedAtMs: number }>()
const PATH_REGISTRY_CACHE_TTL_MS = 5_000

export async function fetchAuctionPathRegistry(auctionEventId: string): Promise<AuctionPathRegistry | null> {
	const cached = pathRegistryCache.get(auctionEventId)
	if (cached && Date.now() - cached.fetchedAtMs < PATH_REGISTRY_CACHE_TTL_MS) {
		return cached.registry
	}
	const ndk = await ensureInvoiceNdkConnected()
	const appPubkey = getAppPublicKeyOrThrow()
	const appSigner = await getAppAuctionSigner()
	const events = Array.from(await ndk.fetchEvents(getAuctionPathRegistryFilter(auctionEventId, appPubkey)))
	const latest = extractAuctionPathRegistryEvent(events)
	if (!latest) return null
	try {
		const decryptable = new NDKEvent(ndk, latest.rawEvent())
		await decryptable.decrypt(new NDKUser({ pubkey: appPubkey }), appSigner, 'nip44')
		const registry = parseAuctionPathRegistry(decryptable.content)
		if (!registry) return null
		pathRegistryCache.set(auctionEventId, { registry, fetchedAtMs: Date.now() })
		return registry
	} catch (error) {
		console.error('[auction] Failed to decrypt path registry:', error)
		return null
	}
}

export async function publishAuctionPathRegistry(registry: AuctionPathRegistry): Promise<void> {
	const ndk = await ensureInvoiceNdkConnected()
	const appPubkey = getAppPublicKeyOrThrow()
	const appSigner = await getAppAuctionSigner()
	const event = new NDKEvent(ndk)
	event.kind = AUCTION_PATH_REGISTRY_KIND
	event.content = JSON.stringify(registry)
	event.tags = getAuctionPathRegistryTags(registry, appPubkey)
	await event.encrypt(new NDKUser({ pubkey: appPubkey }), appSigner, 'nip44')
	await event.sign(appSigner)
	await event.publish()
	pathRegistryCache.set(registry.auctionEventId, { registry, fetchedAtMs: Date.now() })
}
