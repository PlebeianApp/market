import { ndkActions } from '@/lib/stores/ndk'
import { AUCTION_SETTLEMENT_GRACE_SECONDS, nip60Actions, type AuctionP2pkKeyScheme } from '@/lib/stores/nip60'
import { getBidAmount, getBidStatus, markAuctionAsDeleted } from '@/queries/auctions'
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
	keyScheme: AuctionP2pkKeyScheme
	p2pkXpub: string
	isNSFW: boolean
}

export interface AuctionBidFormData {
	auctionEventId: string
	auctionCoordinates: string
	amount: number
	auctionEndAt: number
	sellerPubkey: string
	escrowPubkey: string
	keyScheme: AuctionP2pkKeyScheme
	p2pkXpub?: string
	mint?: string
}

export interface AuctionSettlementFormData {
	auctionEventId: string
	auctionCoordinates?: string
	status: 'settled' | 'reserve_not_met' | 'cancelled'
	closeAt?: number
	winningBidEventId?: string
	winnerPubkey?: string
	finalAmount?: number
	reason?: string
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
	const keyScheme: AuctionP2pkKeyScheme = formData.keyScheme || 'static_p2pk'

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
		['key_scheme', keyScheme],
		...(keyScheme === 'hd_p2pk' && formData.p2pkXpub.trim() ? ([['p2pk_xpub', formData.p2pkXpub.trim()] as NDKTag] as NDKTag[]) : []),
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
	if (formData.keyScheme === 'hd_p2pk' && !formData.p2pkXpub.trim()) {
		throw new Error('p2pk_xpub is required for hd_p2pk auctions')
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

const DEFAULT_BID_MINT = 'https://nofees.testnut.cashu.space'
const AUCTION_BID_KIND = 1023

const ACTIVE_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

const resolveLatestActiveBidByBidder = (bids: NDKEvent[], bidderPubkey: string): NDKEvent | null => {
	const bidderBids = bids.filter((bid) => bid.pubkey === bidderPubkey && ACTIVE_BID_STATUSES.has(getBidStatus(bid)))
	if (!bidderBids.length) return null

	return bidderBids.sort((a, b) => {
		const amountDelta = getBidAmount(b) - getBidAmount(a)
		if (amountDelta !== 0) return amountDelta
		const createdAtDelta = (b.created_at || 0) - (a.created_at || 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return b.id.localeCompare(a.id)
	})[0]
}

export const publishAuctionBid = async (formData: AuctionBidFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')
	if (!formData.auctionCoordinates) throw new Error('Auction coordinates are required')
	if (!formData.sellerPubkey) throw new Error('Seller pubkey is required')
	if (!Number.isFinite(formData.amount) || formData.amount <= 0) throw new Error('Bid amount must be a positive number')
	if (!Number.isFinite(formData.auctionEndAt) || formData.auctionEndAt <= 0) throw new Error('Auction end time is required for locking')

	const now = Math.floor(Date.now() / 1000)
	if (now >= formData.auctionEndAt) {
		throw new Error('Auction already ended')
	}

	const bidderPubkey = (await signer.user()).pubkey
	const ownBidFilters = [
		{
			kinds: [AUCTION_BID_KIND],
			authors: [bidderPubkey],
			'#e': [formData.auctionEventId],
			limit: 200,
		},
		...(formData.auctionCoordinates
			? [
					{
						kinds: [AUCTION_BID_KIND],
						authors: [bidderPubkey],
						'#a': [formData.auctionCoordinates],
						limit: 200,
					},
				]
			: []),
	]
	const existingBids = Array.from(
		await ndkActions.fetchEventsWithTimeout(ownBidFilters.length === 1 ? ownBidFilters[0] : ownBidFilters, { timeoutMs: 2500 }),
	)
	const previousBid = resolveLatestActiveBidByBidder(existingBids, bidderPubkey)
	const previousAmount = previousBid ? getBidAmount(previousBid) : 0
	if (previousAmount > 0 && formData.amount <= previousAmount) {
		throw new Error(`Rebid must exceed your current bid of ${previousAmount.toLocaleString()} sats`)
	}

	const deltaAmount = Math.max(0, formData.amount - previousAmount)
	if (deltaAmount <= 0) {
		throw new Error('No additional funds required for this rebid')
	}

	const bidNonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	const locktime = Math.max(formData.auctionEndAt + AUCTION_SETTLEMENT_GRACE_SECONDS, now + 60)

	const lockedBid = await nip60Actions.lockAuctionBidFunds({
		amount: deltaAmount,
		mint: formData.mint || DEFAULT_BID_MINT,
		lockPubkey: formData.escrowPubkey || formData.sellerPubkey,
		locktime,
		refundPubkey: bidderPubkey,
		keyScheme: formData.keyScheme || 'static_p2pk',
		p2pkXpub: formData.p2pkXpub,
	})

	try {
		const event = new NDKEvent(ndk)
		event.kind = 1023
		event.content = JSON.stringify({
			type: 'cashu_bid_commitment',
			amount: formData.amount,
			delta_amount: deltaAmount,
			prev_amount: previousAmount,
			mint: lockedBid.mintUrl,
			commitment: lockedBid.commitment,
			key_scheme: lockedBid.keyScheme,
		})
		event.tags = [
			['e', formData.auctionEventId],
			['a', formData.auctionCoordinates],
			['p', formData.sellerPubkey],
			['amount', String(formData.amount), 'SAT'],
			['delta_amount', String(deltaAmount), 'SAT'],
			['currency', 'SAT'],
			['mint', lockedBid.mintUrl],
			['commitment', lockedBid.commitment],
			['locktime', String(lockedBid.locktime)],
			['refund_pubkey', lockedBid.refundPubkey],
			['created_for_end_at', String(formData.auctionEndAt)],
			['bid_nonce', bidNonce],
			['key_scheme', lockedBid.keyScheme],
			['status', 'locked'],
			['schema', 'auction_bid_v1'],
		]
		if (previousBid) {
			event.tags.push(['prev_bid', previousBid.id])
			event.tags.push(['prev_amount', String(previousAmount), 'SAT'])
		}
		if (lockedBid.derivationPath) {
			event.tags.push(['derivation_path', lockedBid.derivationPath])
		}
		if (lockedBid.childPubkey) {
			event.tags.push(['child_pubkey', lockedBid.childPubkey])
		}

		await event.sign(signer)
		await ndkActions.publishEvent(event)
		return event.id
	} catch (error) {
		throw new Error(
			`Bid event publish failed after locking funds. Reclaim pending token ${lockedBid.tokenId} from wallet. ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}

export const usePublishAuctionBidMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: AuctionBidFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return publishAuctionBid(formData, signer, ndk)
		},
		onSuccess: async (_eventId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bids(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bidStats(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			toast.success('Bid submitted')
		},
		onError: (error) => {
			console.error('Failed to publish auction bid:', error)
			toast.error(`Failed to submit bid: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

export const publishAuctionSettlement = async (formData: AuctionSettlementFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')
	if (!formData.status) throw new Error('Settlement status is required')

	const closeAt = formData.closeAt ?? Math.floor(Date.now() / 1000)
	const finalAmount = Math.max(0, Math.floor(formData.finalAmount ?? 0))
	const winningBidEventId = formData.winningBidEventId || ''
	const winnerPubkey = formData.winnerPubkey || ''

	if (formData.status === 'settled') {
		if (!winningBidEventId) throw new Error('Winning bid event id is required for settled auctions')
		if (!winnerPubkey) throw new Error('Winner pubkey is required for settled auctions')
		if (finalAmount <= 0) throw new Error('Final amount must be greater than zero for settled auctions')
	}

	const event = new NDKEvent(ndk)
	event.kind = 1024
	event.content = JSON.stringify({
		type: 'auction_settlement',
		status: formData.status,
		winning_bid: winningBidEventId || null,
		winner: winnerPubkey || null,
		final_amount: finalAmount,
		reason: formData.reason || null,
	})
	event.tags = [
		['e', formData.auctionEventId],
		['status', formData.status],
		['close_at', String(closeAt)],
		['winning_bid', winningBidEventId],
		['winner', winnerPubkey],
		['final_amount', String(finalAmount), 'SAT'],
		['schema', 'auction_settlement_v1'],
	]
	if (formData.auctionCoordinates) {
		event.tags.push(['a', formData.auctionCoordinates])
	}
	if (winnerPubkey) {
		event.tags.push(['p', winnerPubkey])
	}
	if (formData.reason?.trim()) {
		event.tags.push(['reason', formData.reason.trim()])
	}

	await event.sign(signer)
	await ndkActions.publishEvent(event)
	return event.id
}

export const usePublishAuctionSettlementMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: AuctionSettlementFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return publishAuctionSettlement(formData, signer, ndk)
		},
		onSuccess: async (_eventId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bids(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bidStats(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.settlements(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			toast.success('Auction settlement published')
		},
		onError: (error) => {
			console.error('Failed to publish auction settlement:', error)
			toast.error(`Failed to publish settlement: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
