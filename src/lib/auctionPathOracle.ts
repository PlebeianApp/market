import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { deriveAuctionChildP2pkPubkeyFromXpub, verifyAuctionPathGrant } from './auctionP2pk'
import type { AuctionPathGrantEnvelope } from './auctionTransfers'

// 30409 is reserved for `featured_auctions` (see src/lib/schemas/featured.ts) —
// we take the next free addressable kind for the path-oracle registry.
export const AUCTION_PATH_REGISTRY_KIND = 30410 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const AUCTION_PATH_REGISTRY_SCHEMA = 'auction_path_registry_v1'
export const AUCTION_PATH_REGISTRY_D_TAG_PREFIX = 'path_oracle'
export const AUCTION_PATH_GRANT_DEFAULT_TTL_SECONDS = 600
export const AUCTION_PATH_HD_DEPTH = 5
export const AUCTION_PATH_HD_MAX_INDEX = 0x7fffffff

export type AuctionPathEntryStatus = 'issued' | 'locked' | 'released' | 'refunded' | 'expired'

export interface AuctionPathRegistryEntry {
	bidderPubkey: string
	derivationPath: string
	childPubkey: string
	grantId: string
	grantedAt: number
	bidEventId?: string
	status: AuctionPathEntryStatus
	releasedAt?: number
	releaseTargetPubkey?: string
}

export interface AuctionPathRegistry {
	type: typeof AUCTION_PATH_REGISTRY_SCHEMA
	auctionEventId: string
	auctionCoordinates: string
	xpub: string
	entries: AuctionPathRegistryEntry[]
	updatedAt: number
}

export const buildAuctionPathRegistryDTag = (auctionRootEventId: string): string =>
	`${AUCTION_PATH_REGISTRY_D_TAG_PREFIX}:${auctionRootEventId}`

const getRandomNonHardenedIndex = (): number => {
	if (globalThis.crypto?.getRandomValues) {
		const buffer = new Uint32Array(1)
		globalThis.crypto.getRandomValues(buffer)
		return buffer[0] & AUCTION_PATH_HD_MAX_INDEX
	}
	return Math.floor(Math.random() * AUCTION_PATH_HD_MAX_INDEX)
}

/**
 * Generate a fresh HD derivation path for a new bid. The path has five
 * non-hardened levels with uniformly random 31-bit indices. Brute-forcing
 * from (xpub, childPubkey) back to the path is computationally infeasible at
 * this entropy level.
 */
export const generateAuctionDerivationPath = (): string => {
	const levels = Array.from({ length: AUCTION_PATH_HD_DEPTH }, () => getRandomNonHardenedIndex())
	return `m/${levels.join('/')}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const parseAuctionPathRegistry = (value: string): AuctionPathRegistry | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_PATH_REGISTRY_SCHEMA) return null
		if (!isNonEmptyString(parsed.auctionEventId) || !isNonEmptyString(parsed.auctionCoordinates)) return null
		if (!isNonEmptyString(parsed.xpub)) return null
		if (!Array.isArray(parsed.entries)) return null
		const entries = parsed.entries
			.map((raw): AuctionPathRegistryEntry | null => {
				if (!isRecord(raw)) return null
				if (!isNonEmptyString(raw.bidderPubkey) || !isNonEmptyString(raw.derivationPath) || !isNonEmptyString(raw.childPubkey)) return null
				if (!isNonEmptyString(raw.grantId)) return null
				if (typeof raw.grantedAt !== 'number') return null
				const status = typeof raw.status === 'string' ? (raw.status as AuctionPathEntryStatus) : 'issued'
				return {
					bidderPubkey: raw.bidderPubkey,
					derivationPath: raw.derivationPath,
					childPubkey: raw.childPubkey,
					grantId: raw.grantId,
					grantedAt: raw.grantedAt,
					bidEventId: isNonEmptyString(raw.bidEventId) ? raw.bidEventId : undefined,
					status,
					releasedAt: typeof raw.releasedAt === 'number' ? raw.releasedAt : undefined,
					releaseTargetPubkey: isNonEmptyString(raw.releaseTargetPubkey) ? raw.releaseTargetPubkey : undefined,
				}
			})
			.filter((entry): entry is AuctionPathRegistryEntry => !!entry)
		return {
			type: AUCTION_PATH_REGISTRY_SCHEMA,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: parsed.auctionCoordinates,
			xpub: parsed.xpub,
			entries,
			updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
		}
	} catch {
		return null
	}
}

export interface AllocateAuctionPathInput {
	auctionEventId: string
	auctionCoordinates: string
	xpub: string
	bidderPubkey: string
	existingEntries?: AuctionPathRegistryEntry[]
	grantId?: string
}

export interface AllocatedAuctionPath {
	derivationPath: string
	childPubkey: string
	grantId: string
	grantedAt: number
}

/**
 * Allocate a fresh derivation path for the given auction + bidder, avoiding any
 * paths already recorded in `existingEntries`. Used by the issuer to answer a
 * `auction_path_request_v1` DM.
 */
export const allocateAuctionPath = (input: AllocateAuctionPathInput): AllocatedAuctionPath => {
	const existing = new Set((input.existingEntries ?? []).map((entry) => entry.derivationPath))
	let derivationPath = generateAuctionDerivationPath()
	let attempts = 0
	while (existing.has(derivationPath) && attempts < 8) {
		derivationPath = generateAuctionDerivationPath()
		attempts += 1
	}
	if (existing.has(derivationPath)) {
		throw new Error('Could not allocate a unique derivation path after 8 attempts')
	}
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(input.xpub, derivationPath)
	const grantId = input.grantId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	const grantedAt = Math.floor(Date.now() / 1000)
	return { derivationPath, childPubkey, grantId, grantedAt }
}

export const upsertAuctionPathEntry = (
	existingEntries: AuctionPathRegistryEntry[],
	update: AuctionPathRegistryEntry,
): AuctionPathRegistryEntry[] => {
	const index = existingEntries.findIndex((entry) => entry.grantId === update.grantId)
	if (index < 0) return [...existingEntries, update]
	const next = [...existingEntries]
	next[index] = { ...next[index], ...update }
	return next
}

export const findAuctionPathEntryByChildPubkey = (
	registry: AuctionPathRegistry | null,
	childPubkey: string,
): AuctionPathRegistryEntry | undefined => {
	if (!registry) return undefined
	return registry.entries.find((entry) => entry.childPubkey.toLowerCase() === childPubkey.toLowerCase())
}

export const findAuctionPathEntryByBidEventId = (
	registry: AuctionPathRegistry | null,
	bidEventId: string,
): AuctionPathRegistryEntry | undefined => {
	if (!registry) return undefined
	return registry.entries.find((entry) => entry.bidEventId === bidEventId)
}

export interface GrantCacheRecord {
	grantId: string
	requestId: string
	auctionEventId: string
	auctionCoordinates: string
	bidderPubkey: string
	pathIssuerPubkey: string
	xpub: string
	derivationPath: string
	childPubkey: string
	issuedAt: number
	expiresAt: number
	status: 'issued' | 'locked' | 'settled' | 'expired'
}

const BIDDER_GRANT_CACHE_KEY = 'auction_path_grants_v1'

const readGrantCache = (): GrantCacheRecord[] => {
	if (typeof localStorage === 'undefined') return []
	try {
		const raw = localStorage.getItem(BIDDER_GRANT_CACHE_KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw) as unknown
		if (!Array.isArray(parsed)) return []
		return parsed.filter((entry): entry is GrantCacheRecord => isRecord(entry) && isNonEmptyString(entry.grantId))
	} catch {
		return []
	}
}

const writeGrantCache = (entries: GrantCacheRecord[]): void => {
	if (typeof localStorage === 'undefined') return
	try {
		localStorage.setItem(BIDDER_GRANT_CACHE_KEY, JSON.stringify(entries))
	} catch (error) {
		console.warn('[auctionPathOracle] Failed to persist bidder grant cache:', error)
	}
}

export const rememberAuctionPathGrant = (record: GrantCacheRecord): void => {
	const entries = readGrantCache()
	const filtered = entries.filter((entry) => entry.grantId !== record.grantId)
	filtered.push(record)
	writeGrantCache(filtered)
}

export const getAuctionPathGrantsForBidder = (bidderPubkey: string, auctionEventId?: string): GrantCacheRecord[] => {
	return readGrantCache().filter((entry) => {
		if (entry.bidderPubkey !== bidderPubkey) return false
		if (auctionEventId && entry.auctionEventId !== auctionEventId) return false
		return true
	})
}

export const markAuctionPathGrantStatus = (grantId: string, status: GrantCacheRecord['status']): void => {
	const entries = readGrantCache()
	const index = entries.findIndex((entry) => entry.grantId === grantId)
	if (index < 0) return
	entries[index] = { ...entries[index], status }
	writeGrantCache(entries)
}

export interface VerifyGrantInput {
	grant: AuctionPathGrantEnvelope
	expectedAuctionEventId: string
	expectedBidderPubkey: string
	expectedPathIssuer: string
	expectedXpub: string
	nowSeconds?: number
}

/**
 * Aggregate verifier used by the bidder immediately on receipt of a grant.
 * Covers the invariants from AUCTIONS.md §5.6 plus the envelope-level checks.
 */
export const verifyAuctionPathGrantEnvelope = (input: VerifyGrantInput): void => {
	const { grant } = input
	const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)

	if (grant.auctionEventId !== input.expectedAuctionEventId) {
		throw new Error('Path grant references a different auction than requested')
	}
	if (grant.bidderPubkey.toLowerCase() !== input.expectedBidderPubkey.toLowerCase()) {
		throw new Error('Path grant bidder pubkey does not match this client')
	}
	if (grant.expiresAt && grant.expiresAt <= now) {
		throw new Error('Path grant has already expired; please request a fresh path')
	}

	verifyAuctionPathGrant({
		xpub: grant.xpub,
		derivationPath: grant.derivationPath,
		childPubkey: grant.childPubkey,
		expectedXpub: input.expectedXpub,
		expectedIssuer: input.expectedPathIssuer,
		grantIssuer: grant.pathIssuerPubkey,
	})
}

export const buildAuctionPathRegistry = (input: {
	auctionEventId: string
	auctionCoordinates: string
	xpub: string
	entries: AuctionPathRegistryEntry[]
}): AuctionPathRegistry => ({
	type: AUCTION_PATH_REGISTRY_SCHEMA,
	auctionEventId: input.auctionEventId,
	auctionCoordinates: input.auctionCoordinates,
	xpub: input.xpub,
	entries: input.entries,
	updatedAt: Date.now(),
})

export const getAuctionPathRegistryTags = (registry: AuctionPathRegistry, pathIssuerPubkey: string): Array<[string, string]> => [
	['d', buildAuctionPathRegistryDTag(registry.auctionEventId)],
	['e', registry.auctionEventId],
	['a', registry.auctionCoordinates],
	['auction_root_event_id', registry.auctionEventId],
	['path_issuer', pathIssuerPubkey],
	['schema', AUCTION_PATH_REGISTRY_SCHEMA],
]

export const getAuctionPathRegistryFilter = (auctionEventId: string, pathIssuerPubkey: string): NDKFilter => ({
	kinds: [AUCTION_PATH_REGISTRY_KIND],
	authors: [pathIssuerPubkey],
	'#d': [buildAuctionPathRegistryDTag(auctionEventId)],
})

export const extractAuctionPathRegistryEvent = (events: NDKEvent[]): NDKEvent | null => {
	if (!events.length) return null
	return events.slice().sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
}
