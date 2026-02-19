import { ndkActions } from '@/lib/stores/ndk'
import { markAuctionAsDeleted } from '@/queries/auctions'
import { auctionKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const DEFAULT_AUCTION_MINT = 'https://nofees.testnut.cashu.space'

export interface AuctionFormData {
	title: string
	summary: string
	description: string
	startingBid: string
	bidIncrement: string
	reserve: string
	startAt?: string
	endAt: string
	mainCategory: string
	categories: string[]
	imageUrls: string[]
	trustedMints: string[]
	isNSFW: boolean
}

const parseUnixTimestamp = (isoDateTime?: string): number | null => {
	if (!isoDateTime) return null
	const timestampMs = new Date(isoDateTime).getTime()
	if (Number.isNaN(timestampMs)) return null
	return Math.floor(timestampMs / 1000)
}

export const createAuctionEvent = async (formData: AuctionFormData, signer: NDKSigner, ndk: NDK, auctionId?: string): Promise<NDKEvent> => {
	const event = new NDKEvent(ndk)
	event.kind = 30408
	event.content = formData.description

	const id = auctionId || `auction_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
	const signerUser = await signer.user()
	const ownerPubkey = signerUser.pubkey
	const now = Math.floor(Date.now() / 1000)

	const startAt = parseUnixTimestamp(formData.startAt) ?? now
	const endAt = parseUnixTimestamp(formData.endAt) ?? now + 86400
	const startingBid = formData.startingBid.trim() || '0'
	const bidIncrement = formData.bidIncrement.trim() || '1'
	const reserve = formData.reserve.trim() || '0'
	const trustedMints = formData.trustedMints.length > 0 ? formData.trustedMints : [DEFAULT_AUCTION_MINT]

	const imageTags = formData.imageUrls.map((url, index) => ['image', url, '800x600', String(index)] as NDKTag)
	const categoryTags: NDKTag[] = []
	if (formData.mainCategory) {
		categoryTags.push(['t', formData.mainCategory] as NDKTag)
	}
	for (const category of formData.categories) {
		if (category && category.trim()) {
			categoryTags.push(['t', category.trim()] as NDKTag)
		}
	}

	event.tags = [
		['d', id],
		['title', formData.title],
		...(formData.summary.trim() ? ([['summary', formData.summary.trim()] as NDKTag] as NDKTag[]) : []),
		['auction_type', 'english'],
		['start_at', String(startAt)],
		['end_at', String(endAt)],
		['currency', 'SAT'],
		['price', startingBid, 'SAT'],
		['starting_bid', startingBid, 'SAT'],
		['bid_increment', bidIncrement],
		['reserve', reserve],
		...trustedMints.map((mint) => ['mint', mint] as NDKTag),
		['escrow_pubkey', ownerPubkey],
		['settlement_policy', 'cashu_p2pk_v1'],
		['schema', 'auction_v1'],
		...imageTags,
		...categoryTags,
		...(formData.isNSFW ? ([['content-warning', 'nsfw'] as NDKTag] as NDKTag[]) : []),
	]

	return event
}

export const publishAuction = async (formData: AuctionFormData, signer: NDKSigner, ndk: NDK, auctionId?: string): Promise<string> => {
	if (!formData.title.trim()) {
		throw new Error('Auction title is required')
	}
	if (!formData.description.trim()) {
		throw new Error('Auction description is required')
	}
	if (!formData.startingBid.trim() || isNaN(Number(formData.startingBid)) || Number(formData.startingBid) < 0) {
		throw new Error('Valid starting bid is required')
	}
	if (!formData.bidIncrement.trim() || isNaN(Number(formData.bidIncrement)) || Number(formData.bidIncrement) <= 0) {
		throw new Error('Bid increment must be greater than 0')
	}
	if (!formData.endAt) {
		throw new Error('Auction end time is required')
	}

	const now = Math.floor(Date.now() / 1000)
	const startAtTs = parseUnixTimestamp(formData.startAt) ?? now
	const endAtTs = parseUnixTimestamp(formData.endAt)
	if (!endAtTs) {
		throw new Error('Invalid auction end time')
	}
	if (endAtTs <= startAtTs) {
		throw new Error('Auction end time must be after start time')
	}
	if (formData.imageUrls.length === 0) {
		throw new Error('At least one image is required')
	}

	const event = await createAuctionEvent(formData, signer, ndk, auctionId)
	await event.sign(signer)
	await ndkActions.publishEvent(event)
	return event.id
}

export const usePublishAuctionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: AuctionFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return publishAuction(formData, signer, ndk)
		},
		onSuccess: async () => {
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				userPubkey = user?.pubkey || ''
			}
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: auctionKeys.byPubkey(userPubkey) })
			}
			toast.success('Auction published successfully')
		},
		onError: (error) => {
			console.error('Failed to publish auction:', error)
			toast.error(`Failed to publish auction: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

export const deleteAuction = async (auctionDTag: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	const deleteEvent = new NDKEvent(ndk)
	deleteEvent.kind = 5
	deleteEvent.content = 'Auction deleted'

	const pubkey = await signer.user().then((user) => user.pubkey)
	deleteEvent.tags = [['a', `30408:${pubkey}:${auctionDTag}`]]

	await deleteEvent.sign(signer)
	await ndkActions.publishEvent(deleteEvent)
	return true
}

export const useDeleteAuctionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (auctionDTag: string) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return deleteAuction(auctionDTag, signer, ndk)
		},
		onSuccess: async (_success, auctionDTag) => {
			markAuctionAsDeleted(auctionDTag)

			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				userPubkey = user?.pubkey || ''
			}

			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: auctionKeys.byPubkey(userPubkey) })
			}
			toast.success('Auction deleted successfully')
		},
		onError: (error) => {
			console.error('Failed to delete auction:', error)
			toast.error(`Failed to delete auction: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
