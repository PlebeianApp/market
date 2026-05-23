import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
	LIVE_ACTIVITY_KIND,
	LIVE_CHAT_KIND,
	buildLiveActivityTags,
	deriveLiveActivityStatus,
	getLiveActivityCoord,
	type LiveActivityStatus,
} from '@/lib/nip53'
import { liveActivityKeys } from '@/queries/queryKeyFactory'
import {
	getAuctionId,
	getAuctionTitle,
	getAuctionSummary,
	getAuctionImages,
	getAuctionCategories,
} from '@/queries/auctions'
import { getAuctionStartAt, getAuctionMaxEndAt } from '@/lib/auctionSettlement'

interface PublishLiveActivityParams {
	auctionEvent: NDKEvent
}

export const publishLiveActivity = async ({ auctionEvent }: PublishLiveActivityParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const dTag = getAuctionId(auctionEvent)
	if (!dTag) throw new Error('Auction has no d tag')

	const startsAt = getAuctionStartAt(auctionEvent)
	const maxEndAt = getAuctionMaxEndAt(auctionEvent)
	const status = deriveLiveActivityStatus(startsAt, maxEndAt)
	const title = getAuctionTitle(auctionEvent)
	const summary = getAuctionSummary(auctionEvent)
	const images = getAuctionImages(auctionEvent)
	const categories = getAuctionCategories(auctionEvent)
	const connectedRelays = ndk.pool?.connectedRelays() || []
	const relayUrls = connectedRelays.map((r) => r.url)

	const tags = buildLiveActivityTags({
		dTag,
		sellerPubkey: auctionEvent.pubkey,
		title,
		summary,
		image: images.length > 0 ? images[0][1] : undefined,
		startsAt,
		maxEndAt,
		status,
		relays: relayUrls,
		categories,
	})

	const event = new NDKEvent(ndk)
	event.kind = LIVE_ACTIVITY_KIND
	event.content = ''
	event.tags = tags
	event.created_at = Math.floor(Date.now() / 1000)

	await event.sign(ndk.signer)
	await ndkActions.publishEvent(event)

	return event
}

interface PublishLiveChatMessageParams {
	liveActivityCoord: string
	content: string
}

export const publishLiveChatMessage = async ({
	liveActivityCoord,
	content,
}: PublishLiveChatMessageParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const user = await ndk.signer.user()
	if (!user) throw new Error('No active user')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays')
	}

	const relayHint = connectedRelays[0]?.url ?? ''

	const event = new NDKEvent(ndk)
	event.kind = LIVE_CHAT_KIND
	event.content = content
	event.created_at = Math.floor(Date.now() / 1000)
	event.pubkey = user.pubkey
	event.tags = [['a', liveActivityCoord, relayHint, 'root']]

	await event.sign(ndk.signer)
	await ndkActions.publishEvent(event)

	return event
}

interface UpdateLiveActivityStatusParams {
	dTag: string
	sellerPubkey: string
	existingEvent: NDKEvent
	newStatus: LiveActivityStatus
}

export const updateLiveActivityStatus = async ({
	existingEvent,
	newStatus,
}: UpdateLiveActivityStatusParams): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const tags = existingEvent.tags.map((tag) => {
		if (tag[0] === 'status') return ['status', newStatus]
		return tag
	})

	const event = new NDKEvent(ndk)
	event.kind = LIVE_ACTIVITY_KIND
	event.content = ''
	event.tags = tags
	event.created_at = Math.floor(Date.now() / 1000)

	await event.sign(ndk.signer)
	await ndkActions.publishEvent(event)

	return event
}

export const usePublishLiveChatMessageMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishLiveChatMessage,
		onSuccess: async (_event, variables) => {
			await queryClient.invalidateQueries({
				queryKey: liveActivityKeys.chatMessages(variables.liveActivityCoord),
			})
		},
		onError: (error) => {
			console.error('Failed to send chat message:', error)
			toast.error('Failed to send message')
		},
	})
}

export const usePublishLiveActivityMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishLiveActivity,
		onSuccess: async (_event, variables) => {
			const dTag = getAuctionId(variables.auctionEvent)
			const coord = getLiveActivityCoord(variables.auctionEvent.pubkey, dTag)
			await queryClient.invalidateQueries({
				queryKey: liveActivityKeys.byCoord(coord),
			})
		},
		onError: (error) => {
			console.error('Failed to publish live activity:', error)
			toast.error('Failed to create live activity')
		},
	})
}
