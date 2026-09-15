import { parseStorefrontPage, type StorefrontPage } from '@/lib/schemas/storefront'
import { fetchEvents, subscribe } from '@/lib/nostr/io'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { storefrontKeys } from './queryKeyFactory'

export interface StorefrontIdentityEntry {
	name: string
	pubkey: string
	validUntil: number
}

export interface StorefrontPageData {
	page: StorefrontPage
	eventId: string
	createdAt: number
}

export async function fetchStorefrontIdentities(appPubkey: string): Promise<StorefrontIdentityEntry[]> {
	const events = await fetchEvents({ kinds: [30000], authors: [appPubkey], '#d': ['storefront-names'], limit: 20 })
	const latest = events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
	if (!latest) return []
	return latest.tags.flatMap((tag) => {
		if (tag[0] !== 'name' || !tag[1] || !tag[2] || !tag[3]) return []
		const validUntil = Number.parseInt(tag[3], 10)
		return Number.isFinite(validUntil) ? [{ name: tag[1].toLowerCase(), pubkey: tag[2], validUntil }] : []
	})
}

export function useStorefrontIdentities(appPubkey: string | undefined) {
	return useQuery({
		queryKey: storefrontKeys.all,
		queryFn: () => fetchStorefrontIdentities(appPubkey as string),
		enabled: Boolean(appPubkey),
		staleTime: 30_000,
	})
}

export async function fetchStorefrontPage(pubkey: string): Promise<StorefrontPageData | null> {
	const events = await fetchEvents({ kinds: [30024], authors: [pubkey], '#d': ['storefront-page'], limit: 20 })
	const candidates = events
		.filter(
			(event) =>
				event.kind === 30024 && event.pubkey === pubkey && event.tags.some((tag) => tag[0] === 'd' && tag[1] === 'storefront-page'),
		)
		.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))

	for (const event of candidates) {
		const page = parseStorefrontPage(event.content)
		if (page) return { page, eventId: event.id, createdAt: event.created_at ?? 0 }
	}

	return null
}

export function useStorefrontPage(pubkey: string | null | undefined) {
	const queryClient = useQueryClient()

	useEffect(() => {
		if (!pubkey) return
		return subscribe(
			{ kinds: [30024], authors: [pubkey], '#d': ['storefront-page'] },
			() => void queryClient.invalidateQueries({ queryKey: storefrontKeys.page(pubkey) }),
			{ closeOnEose: false },
		)
	}, [pubkey, queryClient])

	return useQuery({
		queryKey: storefrontKeys.page(pubkey ?? ''),
		queryFn: () => fetchStorefrontPage(pubkey as string),
		enabled: Boolean(pubkey),
		staleTime: 60_000,
	})
}
