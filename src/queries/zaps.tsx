import { ndkStore } from '@/lib/stores/ndk'
import { zapKeys } from './queryKeyFactory'
import { useQuery } from '@tanstack/react-query'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { buildProfileMetadataFilter } from '@sdk/core/profile'
import {
	assertLnurlAllowsNostr,
	buildLnurlPayUrl,
	buildProviderZapReceiptFilter,
	parseProfileLud16,
	parseProviderZapReceipt,
	sortZapReceiptsNewestFirst,
	type LnurlPayResponse,
	type ZapReceiptRecord,
} from '@sdk/commerce/payments'

export type LightningZap = ZapReceiptRecord<NDKEvent>

/**
 * Step 1: Fetch User Profile to get lud16
 */
const getUserLud16 = async (userPubkey: string): Promise<string | null> => {
	const ndk = ndkStore.state.zapNdk
	if (!ndk) throw new Error('NDK not initialized')

	const profileEvents = await ndk.fetchEvents({ ...buildProfileMetadataFilter(userPubkey), limit: 1 })

	const profile = Array.from(profileEvents)[0]
	if (!profile) return null

	try {
		return parseProfileLud16(profile.content)
	} catch (e) {
		console.error('Failed to parse profile content', e)
		return null
	}
}

/**
 * Step 2: Resolve LNURL to get Provider Info
 */
const resolveLnurl = async (lud16: string): Promise<LnurlPayResponse> => {
	const url = buildLnurlPayUrl(lud16)
	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`LNURL resolution failed for ${lud16}: ${response.statusText}`)
	}

	return assertLnurlAllowsNostr(await response.json(), lud16)
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

	// 3. Fetch zap receipts signed by the provider, tagged to the user (and target event if provided)
	const filter = buildProviderZapReceiptFilter({ providerPubkey, recipientPubkey: userPubkey, targetEventId })

	const events = await ndk.fetchEvents(filter)
	const validZaps: LightningZap[] = []

	for (const event of Array.from(events)) {
		try {
			const zap = parseProviderZapReceipt(event, { recipientPubkey: userPubkey, targetEventId })
			if (!zap) {
				console.error('No valid payment amount found for lightning zap.')
				continue
			}

			validZaps.push(zap)
		} catch (e) {
			console.error('Failed to parse zap description for event', event.id, e)
		}
	}

	return sortZapReceiptsNewestFirst(validZaps)
}

export const useZapsViaProvider = (event: NDKEvent) => {
	return useQuery({
		queryKey: zapKeys.byProvider(event.pubkey, event.id), // You'll need to add this key
		queryFn: () => fetchZapsForUserViaProvider(event.pubkey, event.id),
		enabled: !!event.pubkey,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
