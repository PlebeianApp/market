import { ndkStore } from '@/lib/stores/ndk'
import { zapKeys } from './queryKeyFactory'
import { useQuery } from '@tanstack/react-query'
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { decode } from 'light-bolt11-decoder'

export interface LightningZap {
	id: string
	amountMillisats: number
	message: string
	senderPubkey: string
	recipientPubkey: string
	providerPubkey?: string // nostr-pubkey of provider e.g. CoinOS, Alby
	targetEventId?: string
	targetEventKind?: number
	bolt11: string
	descriptionHash: string // SHA256 of the zap request
	createdAt: number
	rawEvent: NDKEvent
}

interface LnurlResponse {
	allowsNostr: boolean
	nostrPubkey: string
	callback: string
	minSendable: number
	maxSendable: number
	metadata: string
	tag: string
}

/**
 * Step 1: Fetch User Profile to get lud16
 */
const getUserLud16 = async (userPubkey: string): Promise<string | null> => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw new Error('NDK not initialized')

	const profileEvents = await ndk.fetchEvents({
		kinds: [0],
		authors: [userPubkey],
		limit: 1,
	})

	const profile = Array.from(profileEvents)[0]
	if (!profile) return null

	try {
		const content = JSON.parse(profile.content)
		return content.lud16 || null
	} catch (e) {
		console.error('Failed to parse profile content', e)
		return null
	}
}

/**
 * Step 2: Resolve LNURL to get Provider Info
 */
const resolveLnurl = async (lud16: string): Promise<LnurlResponse> => {
	const [username, domain] = lud16.split('@')
	if (!username || !domain) throw new Error('Invalid lud16 format')

	const url = `https://${domain}/.well-known/lnurlp/${username}`
	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`LNURL resolution failed for ${lud16}: ${response.statusText}`)
	}

	const data = await response.json()

	if (!data.allowsNostr || !data.nostrPubkey) {
		throw new Error(`LNURL for ${lud16} does not support Nostr zaps`)
	}

	return data
}

/**
 * Step 3 & 4: Fetch Zaps from Provider and Filter for User
 */
export const fetchZapsForUserViaProvider = async (userPubkey: string, targetEventId?: string): Promise<LightningZap[]> => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw new Error('NDK not initialized')

	// 1. Get lud16
	const lud16 = await getUserLud16(userPubkey)
	if (!lud16) {
		console.warn(`No lud16 found for user ${userPubkey}`)
		return []
	}

	// 2. Resolve LNURL to get Provider's Pubkey
	let providerPubkey: string
	try {
		const lnurlData = await resolveLnurl(lud16)
		providerPubkey = lnurlData.nostrPubkey
	} catch (e) {
		console.error('Failed to resolve LNURL', e)
		return []
	}

	// 3. Fetch zaps signed by the Provider
	const filter: NDKFilter = {
		kinds: [9735],
		authors: [providerPubkey], // Fetch events SIGNED by the provider
		limit: 100, // Adjust based on expected volume
	}

	// We add the target pubkey as a #p tag:
	filter['#p'] = [userPubkey]

	// Optionally, we can add the target event id if provided.
	if (targetEventId) {
		filter['#e'] = [targetEventId]
	}

	const events = await ndk.fetchEvents(filter)
	const validZaps: LightningZap[] = []

	for (const event of Array.from(events)) {
		try {
			const senderPubkey = event.tags.find((t: any[]) => t[0] === 'P')?.[1] ?? ''
			const comment = event.content
			const bolt11Tag = event.tags.find((t: any[]) => t[0] === 'bolt11')?.[1] ?? ''
			const eventCoordinates = event.tags.find((t: any[]) => t[0] === 'a')?.[1]
			const eventId = event.tags.find((t: any[]) => t[0] === 'e')?.[1] ?? targetEventId

			const amountMillisatsRaw = decode(bolt11Tag).sections.find((s) => s.name == 'amount')?.value
			if (!amountMillisatsRaw) {
				console.error('No valid payment amount found for lightning zap.')
				continue
			}

			validZaps.push({
				id: event.id,
				amountMillisats: parseInt(amountMillisatsRaw),
				message: comment,
				senderPubkey,
				recipientPubkey: userPubkey,
				targetEventId: eventId,
				bolt11: bolt11Tag || '',
				createdAt: event.created_at || 0,
				rawEvent: event,
				providerPubkey: event.pubkey, // The signer (Coinos),
				descriptionHash: event.tags.find((t) => t[0] === 'bolt11')?.[2] || '',
			})
		} catch (e) {
			console.error('Failed to parse zap description for event', event.id, e)
		}
	}

	return validZaps.sort((a, b) => b.createdAt - a.createdAt)
}

export const useZapsViaProvider = (event: NDKEvent) => {
	return useQuery({
		queryKey: zapKeys.byProvider(event.pubkey, event.id), // You'll need to add this key
		queryFn: () => fetchZapsForUserViaProvider(event.pubkey, event.id),
		enabled: !!event.pubkey,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
