import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'

export const STALL_KIND = 30017

export interface StallShippingZone {
	id: string
	name?: string
	cost: number
	regions: string[]
}

export interface StallContent {
	id: string
	name: string
	description?: string
	currency: string
	shipping: StallShippingZone[]
}

export interface ShopProfile {
	id: string
	name: string
	description?: string
	currency: string
	shipping: StallShippingZone[]
	banner?: string
	picture?: string
	location?: string
}

export interface StallWithProducts {
	stall: ShopProfile
	products: NDKEvent[]
}

// Event helpers
function parseStallEvent(event: NDKEvent): ShopProfile | null {
	try {
		const content = JSON.parse(event.content) as StallContent
		const getTag = (name: string) => event.tags.find((t) => t[0] === name)?.[1]
		return {
			id: content.id,
			name: content.name,
			description: content.description,
			currency: content.currency,
			shipping: content.shipping ?? [],
			banner: getTag('banner'),
			picture: getTag('picture'),
			location: getTag('location'),
		}
	} catch (e) {
		console.error('Failed to parse stall event:', e)
		return null
	}
}

function buildStallEvent(ndk: InstanceType<typeof import('@nostr-dev-kit/ndk').default>, shop: ShopProfile): NDKEvent {
	const content: StallContent = {
		id: shop.id,
		name: shop.name,
		description: shop.description,
		currency: shop.currency,
		shipping: shop.shipping,
	}
	const event = new NDKEvent(ndk)
	event.kind = STALL_KIND as any
	event.content = JSON.stringify(content)
	event.tags = [['d', shop.id]]
	if (shop.banner) event.tags.push(['banner', shop.banner])
	if (shop.picture) event.tags.push(['picture', shop.picture])
	if (shop.location) event.tags.push(['location', shop.location])
	return event
}

export const fetchShopProfile = async (pubkey: string, stallId?: string): Promise<ShopProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk || !pubkey) return null
	try {
		const filter: Record<string, any> = { kinds: [STALL_KIND], authors: [pubkey] }
		if (stallId) filter['#d'] = [stallId]
		const event = await ndk.fetchEvent(filter)
		if (!event) return null
		return parseStallEvent(event)
	} catch (e) {
		console.error('Failed to fetch shop profile:', e)
		return null
	}
}

export const fetchAllShopProfiles = async (pubkey: string): Promise<ShopProfile[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk || !pubkey) return []
	try {
		const events = await ndk.fetchEvents({ kinds: [STALL_KIND as any], authors: [pubkey] })
		return Array.from(events)
			.map(parseStallEvent)
			.filter((s): s is ShopProfile => s !== null)
	} catch (e) {
		console.error('Failed to fetch all shop profiles:', e)
		return []
	}
}

export function getProductStallId(product: NDKEvent): string | null {
	try {
		const content = JSON.parse(product.content)
		return content?.stall_id ?? null
	} catch {
		return null
	}
}

export function groupProductsByStall(
	stalls: ShopProfile[],
	products: NDKEvent[],
): { grouped: StallWithProducts[]; ungroupedProducts: NDKEvent[] } {
	if (stalls.length === 0) {
		// no stalls at all — return everything as ungrouped
		return { grouped: [], ungroupedProducts: products }
	}

	const stallMap = new Map<string, ShopProfile>(stalls.map((s) => [s.id, s]))
	const stallProductsMap = new Map<string, NDKEvent[]>()
	const ungroupedProducts: NDKEvent[] = []

	for (const product of products) {
		const stallId = getProductStallId(product)
		if (stallId && stallMap.has(stallId)) {
			if (!stallProductsMap.has(stallId)) stallProductsMap.set(stallId, [])
			stallProductsMap.get(stallId)!.push(product)
		} else {
			ungroupedProducts.push(product)
		}
	}

	const grouped: StallWithProducts[] = stalls.map((stall) => ({
		stall,
		products: stallProductsMap.get(stall.id) ?? [],
	}))

	return { grouped, ungroupedProducts }
}

// Publish
export const publishShopProfile = async (shop: ShopProfile): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available — please connect your Nostr account')
	const event = buildStallEvent(ndk, shop)
	await event.publish()
	return event
}

export function createEmptyShopProfile(): ShopProfile {
	return { id: uuidv4(), name: '', description: '', currency: 'SATS', shipping: [] }
}

// Query options
export const shopProfileQueryOptions = (pubkey: string, stallId?: string) =>
	queryOptions({
		queryKey: ['shopProfile', pubkey, stallId ?? 'primary'],
		queryFn: () => fetchShopProfile(pubkey, stallId),
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000,
	})

export const allShopProfilesQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: ['shopProfiles', pubkey],
		queryFn: () => fetchAllShopProfiles(pubkey),
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000,
	})

// React hooks
export const useShopProfile = (pubkey: string | undefined, stallId?: string) =>
	useQuery({ ...shopProfileQueryOptions(pubkey ?? '', stallId), enabled: !!pubkey })

export const useAllShopProfiles = (pubkey: string | undefined) =>
	useQuery({ ...allShopProfilesQueryOptions(pubkey ?? ''), enabled: !!pubkey })

export const usePublishShopProfileMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const pubkey = ndk?.activeUser?.pubkey
	return useMutation({
		mutationFn: (shop: ShopProfile) => publishShopProfile(shop),
		onSuccess: () => {
			if (pubkey) {
				queryClient.invalidateQueries({ queryKey: ['shopProfile', pubkey] })
				queryClient.invalidateQueries({ queryKey: ['shopProfiles', pubkey] })
			}
		},
	})
}

// Merge helper
export function mergeShopWithProfile<T>(shopValue: T | undefined | null, profileValue: T | undefined | null): T | undefined {
	if (shopValue !== undefined && shopValue !== null && shopValue !== ('' as any)) return shopValue as T
	return profileValue as T | undefined
}
