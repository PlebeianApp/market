import {
	AUCTION_BID_ENVELOPE_MARKER,
	AUCTION_BID_TOKEN_TOPIC,
	AUCTION_REFUND_SOURCE_MARKER,
	AUCTION_REFUND_TOPIC,
	AUCTION_TRANSFER_DM_KIND,
	type AuctionBidTokenEnvelope,
	type AuctionRefundEnvelope,
	type AuctionRefundTransfer,
	getMarkedEventIds,
	parseAuctionBidTokenEnvelope,
} from '@/lib/auctionTransfers'
import { ndkActions } from '@/lib/stores/ndk'
import { AUCTION_SETTLEMENT_GRACE_SECONDS, nip60Actions, type AuctionP2pkKeyScheme } from '@/lib/stores/nip60'
import { getBidAmount, getBidStatus, markAuctionAsDeleted } from '@/queries/auctions'
import { auctionKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, NDKPrivateKeySigner, NDKUser, type NDKFilter, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
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

export interface AuctionBidFormData {
	auctionEventId: string
	auctionCoordinates: string
	amount: number
	auctionEndAt: number
	sellerPubkey: string
	escrowPubkey: string
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
	const now = Math.floor(Date.now() / 1000)

	const startAt = parseUnixTimestamp(formData.startAt) ?? now
	const endAt = parseUnixTimestamp(formData.endAt) ?? now + 86400
	const startingBid = formData.startingBid.trim() || '0'
	const bidIncrement = formData.bidIncrement.trim() || '1'
	const reserve = formData.reserve.trim() || '0'
	const trustedMints = formData.trustedMints.length > 0 ? formData.trustedMints : [DEFAULT_AUCTION_MINT]
	const keyScheme: AuctionP2pkKeyScheme = 'hd_p2pk'
	const escrowPubkey = await nip60Actions.getWalletP2pk()
	const p2pkXpub = await nip60Actions.getAuctionP2pkXpub()

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
		['escrow_pubkey', escrowPubkey],
		['key_scheme', keyScheme],
		['p2pk_xpub', p2pkXpub],
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

const DEFAULT_BID_MINT = 'https://nofees.testnut.cashu.space'
const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_SETTLEMENT_KIND = 1024 as unknown as NonNullable<NDKFilter['kinds']>[number]

const ACTIVE_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const getFirstTagValue = (event: NDKEvent, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''

const parseNonNegativeInt = (value?: string, fallback: number = 0): number => {
	const parsed = value ? parseInt(value, 10) : NaN
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const getBidDeltaAmount = (bid: NDKEvent): number => {
	const deltaTag = getFirstTagValue(bid, 'delta_amount')
	if (deltaTag) return parseNonNegativeInt(deltaTag, 0)
	const amount = getBidAmount(bid)
	const previousAmount = parseNonNegativeInt(getFirstTagValue(bid, 'prev_amount'), 0)
	return Math.max(0, amount - previousAmount)
}

const isSpentTokenError = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	return message.includes('already spent') || message.includes('token spent') || message.includes('proof not found')
}

type BidChainGroup = {
	bidderPubkey: string
	latestBid: NDKEvent
	chain: NDKEvent[]
}

const collectBidChain = (latestBid: NDKEvent, bidById: Map<string, NDKEvent>): NDKEvent[] => {
	const chain: NDKEvent[] = []
	const seen = new Set<string>()
	let current: NDKEvent | undefined = latestBid

	while (current && !seen.has(current.id)) {
		chain.unshift(current)
		seen.add(current.id)
		const previousBidId = getFirstTagValue(current, 'prev_bid')
		if (!previousBidId) break
		const previousBid = bidById.get(previousBidId)
		if (!previousBid) {
			throw new Error(`Missing previous bid event ${previousBidId} for bid ${latestBid.id}`)
		}
		current = previousBid
	}

	return chain
}

const buildActiveBidChains = (bids: NDKEvent[]): BidChainGroup[] => {
	const latestByBidder = new Map<string, NDKEvent>()
	for (const bid of bids) {
		if (!ACTIVE_BID_STATUSES.has(getBidStatus(bid))) continue
		const existing = latestByBidder.get(bid.pubkey)
		if (!existing) {
			latestByBidder.set(bid.pubkey, bid)
			continue
		}

		const amountDelta = getBidAmount(bid) - getBidAmount(existing)
		if (amountDelta > 0) {
			latestByBidder.set(bid.pubkey, bid)
			continue
		}
		if (amountDelta === 0) {
			const createdAtDelta = (bid.created_at || 0) - (existing.created_at || 0)
			if (createdAtDelta > 0 || (createdAtDelta === 0 && bid.id.localeCompare(existing.id) > 0)) {
				latestByBidder.set(bid.pubkey, bid)
			}
		}
	}

	const bidById = new Map(bids.map((bid) => [bid.id, bid]))
	return Array.from(latestByBidder.entries()).map(([bidderPubkey, latestBid]) => ({
		bidderPubkey,
		latestBid,
		chain: collectBidChain(latestBid, bidById),
	}))
}

const publishEncryptedAuctionTransfer = async (
	params: {
		recipientPubkey: string
		senderSigner: NDKSigner
		ndk: NDK
		tags: NDKTag[]
		content: AuctionBidTokenEnvelope | AuctionRefundEnvelope
	},
): Promise<NDKEvent> => {
	const event = new NDKEvent(params.ndk)
	event.kind = AUCTION_TRANSFER_DM_KIND
	event.content = JSON.stringify(params.content)
	event.tags = [['p', params.recipientPubkey], ...params.tags]
	await event.encrypt(new NDKUser({ pubkey: params.recipientPubkey }), params.senderSigner, 'nip44')
	await event.sign(params.senderSigner)
	await ndkActions.publishEvent(event)
	return event
}

const fetchAuctionBidTokenEnvelopes = async (
	auctionEventId: string,
	auctionCoordinates: string | undefined,
	escrowPubkey: string,
	escrowSigner: NDKSigner,
	ndk: NDK,
): Promise<Map<string, AuctionBidTokenEnvelope>> => {
	const filters: NDKFilter[] = [
		{
			kinds: [AUCTION_TRANSFER_DM_KIND],
			'#p': [escrowPubkey],
			'#t': [AUCTION_BID_TOKEN_TOPIC],
			'#e': [auctionEventId],
			limit: 500,
		},
	]
	if (auctionCoordinates) {
		filters.push({
			kinds: [AUCTION_TRANSFER_DM_KIND],
			'#p': [escrowPubkey],
			'#t': [AUCTION_BID_TOKEN_TOPIC],
			'#a': [auctionCoordinates],
			limit: 500,
		})
	}

	const events = Array.from(await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 5000 }))
	const envelopes = new Map<string, AuctionBidTokenEnvelope>()

	for (const event of events) {
		try {
			const decryptable = new NDKEvent(ndk, event.rawEvent())
			await decryptable.decrypt(new NDKUser({ pubkey: event.pubkey }), escrowSigner, 'nip44')
			const envelope = parseAuctionBidTokenEnvelope(decryptable.content)
			if (!envelope || envelope.auctionEventId !== auctionEventId) continue
			envelopes.set(envelope.bidEventId, envelope)
		} catch (error) {
			console.error('[auctions] Failed to decrypt bid escrow envelope:', error)
		}
	}

	return envelopes
}

const fetchExistingRefundEventIds = async (
	auctionEventId: string,
	sellerPubkey: string,
	bidderPubkey: string,
	ndk: NDK,
): Promise<Set<string>> => {
	const events = Array.from(
		await ndkActions.fetchEventsWithTimeout(
			{
				kinds: [AUCTION_TRANSFER_DM_KIND],
				authors: [sellerPubkey],
				'#p': [bidderPubkey],
				'#t': [AUCTION_REFUND_TOPIC],
				'#e': [auctionEventId],
				limit: 100,
			},
			{ timeoutMs: 4000 },
		),
	)

	return new Set(events.flatMap((event) => getMarkedEventIds(event.tags, AUCTION_REFUND_SOURCE_MARKER)))
}

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

	const bidderWalletP2pk = await nip60Actions.getWalletP2pk()
	const bidNonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	const locktime = Math.max(formData.auctionEndAt + AUCTION_SETTLEMENT_GRACE_SECONDS, now + 60)

	const lockedBid = await nip60Actions.lockAuctionBidFunds({
		amount: deltaAmount,
		mint: formData.mint || DEFAULT_BID_MINT,
		lockPubkey: formData.escrowPubkey || formData.sellerPubkey,
		locktime,
		refundPubkey: bidderWalletP2pk,
		auctionEventId: formData.auctionEventId,
		auctionCoordinates: formData.auctionCoordinates,
		sellerPubkey: formData.sellerPubkey,
		p2pkXpub: formData.p2pkXpub,
	})

	try {
		const event = new NDKEvent(ndk)
		event.kind = AUCTION_BID_KIND
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
		await publishEncryptedAuctionTransfer({
			recipientPubkey: formData.escrowPubkey || formData.sellerPubkey,
			senderSigner: signer,
			ndk,
			tags: [
				['t', AUCTION_BID_TOKEN_TOPIC],
				['e', formData.auctionEventId],
				['e', event.id, '', AUCTION_BID_ENVELOPE_MARKER],
				['a', formData.auctionCoordinates],
				['mint', lockedBid.mintUrl],
				['commitment', lockedBid.commitment],
			],
			content: {
				type: AUCTION_BID_TOKEN_TOPIC,
				auctionEventId: formData.auctionEventId,
				auctionCoordinates: formData.auctionCoordinates,
				bidEventId: event.id,
				bidderPubkey,
				sellerPubkey: formData.sellerPubkey,
				escrowPubkey: formData.escrowPubkey || formData.sellerPubkey,
				refundPubkey: lockedBid.refundPubkey,
				lockPubkey: lockedBid.lockPubkey,
				locktime: lockedBid.locktime,
				mintUrl: lockedBid.mintUrl,
				amount: lockedBid.amount,
				totalBidAmount: formData.amount,
				commitment: lockedBid.commitment,
				bidNonce,
				token: lockedBid.token,
				createdAt: Date.now(),
			},
		})
		await ndkActions.publishEvent(event)
		nip60Actions.updatePendingTokenContext(lockedBid.tokenId, {
			kind: 'auction_bid',
			auctionEventId: formData.auctionEventId,
			auctionCoordinates: formData.auctionCoordinates,
			bidEventId: event.id,
			sellerPubkey: formData.sellerPubkey,
			escrowPubkey: formData.escrowPubkey || formData.sellerPubkey,
			lockPubkey: lockedBid.lockPubkey,
			refundPubkey: lockedBid.refundPubkey,
			locktime: lockedBid.locktime,
		})
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

	const sellerUser = await signer.user()
	const sellerPubkey = sellerUser.pubkey
	const auctionEvent = Array.from(
		await ndkActions.fetchEventsWithTimeout(
			{
				kinds: [AUCTION_KIND],
				ids: [formData.auctionEventId],
				limit: 1,
			},
			{ timeoutMs: 4000 },
		),
	)[0]
	if (!auctionEvent) throw new Error('Auction not found')
	if (auctionEvent.pubkey !== sellerPubkey) {
		throw new Error('Only the auction owner can settle this auction')
	}

	if (getFirstTagValue(auctionEvent, 'key_scheme') && getFirstTagValue(auctionEvent, 'key_scheme') !== 'hd_p2pk') {
		throw new Error('Only hd_p2pk auction settlement is supported')
	}

	const auctionCoordinates = formData.auctionCoordinates || (() => {
		const dTag = getFirstTagValue(auctionEvent, 'd')
		return dTag ? `30408:${auctionEvent.pubkey}:${dTag}` : ''
	})()
	const escrowPubkey = getFirstTagValue(auctionEvent, 'escrow_pubkey') || auctionEvent.pubkey
	const auctionP2pkXpub = getFirstTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!auctionP2pkXpub) {
		throw new Error('Auction is missing p2pk_xpub')
	}
	const walletEscrowPrivkey = await nip60Actions.ensureWalletPrivkey(escrowPubkey, sellerPubkey)
	const escrowSigner = walletEscrowPrivkey
		? new NDKPrivateKeySigner(walletEscrowPrivkey)
		: sellerPubkey === escrowPubkey
			? signer
			: null
	if (!escrowSigner) {
		throw new Error('Current wallet or signer cannot decrypt this auction escrow key')
	}
	const walletAuctionXpub = await nip60Actions.getAuctionP2pkXpub()
	if (walletAuctionXpub !== auctionP2pkXpub) {
		throw new Error('Auction p2pk_xpub does not match the current wallet-derived auction HD root')
	}

	const existingSettlements = Array.from(
		await ndkActions.fetchEventsWithTimeout(
			{
				kinds: [AUCTION_SETTLEMENT_KIND],
				'#e': [formData.auctionEventId],
				limit: 20,
			},
			{ timeoutMs: 3000 },
		),
	)
	if (existingSettlements.length > 0) {
		throw new Error('Settlement already published for this auction')
	}

	const bidFilters: NDKFilter[] = [
		{
			kinds: [AUCTION_BID_KIND],
			'#e': [formData.auctionEventId],
			limit: 500,
		},
		...(auctionCoordinates
			? [
					{
						kinds: [AUCTION_BID_KIND],
						'#a': [auctionCoordinates],
						limit: 500,
					},
				]
			: []),
	]
	const bids = Array.from(await ndkActions.fetchEventsWithTimeout(bidFilters.length === 1 ? bidFilters[0] : bidFilters, { timeoutMs: 5000 }))
	const activeBidChains = buildActiveBidChains(bids)
	const envelopeByBidEventId = await fetchAuctionBidTokenEnvelopes(formData.auctionEventId, auctionCoordinates, escrowPubkey, escrowSigner, ndk)
	const redeemBidEnvelope = async (bid: NDKEvent, amount: number, token: string): Promise<void> => {
		const derivationPath = getFirstTagValue(bid, 'derivation_path')
		if (!derivationPath) {
			throw new Error(`Bid ${bid.id} is missing derivation_path`)
		}
		const expectedPubkey = getFirstTagValue(bid, 'child_pubkey') || undefined
		const childPrivkey = await nip60Actions.getAuctionHdChildPrivkey({ derivationPath, expectedPubkey })
		try {
			await nip60Actions.receiveLockedEcash(token, childPrivkey)
		} catch (error) {
			if (!isSpentTokenError(error)) throw error
		}
	}

	let winnerPayoutAmount = 0
	const settlementTags: NDKTag[] = []

	if (formData.status === 'settled') {
		const winnerChain = activeBidChains.find((group) => group.latestBid.id === winningBidEventId && group.bidderPubkey === winnerPubkey)
		if (!winnerChain) {
			throw new Error('Winning bid chain could not be resolved')
		}

		const winnerEnvelopes = winnerChain.chain.map((bid) => {
			const envelope = envelopeByBidEventId.get(bid.id)
			if (!envelope) throw new Error(`Missing private bid token for winning bid ${bid.id}`)
			return envelope
		})

		for (const [index, envelope] of winnerEnvelopes.entries()) {
			await redeemBidEnvelope(winnerChain.chain[index], envelope.amount, envelope.token)
			winnerPayoutAmount += envelope.amount
		}

		if (winnerPayoutAmount !== finalAmount) {
			throw new Error(`Winning bid proofs total ${winnerPayoutAmount} sats, expected ${finalAmount} sats`)
		}

		settlementTags.push(['payout', winningBidEventId, String(winnerPayoutAmount), 'redeemed'])
	}

	const refundGroups = activeBidChains.filter((group) => formData.status !== 'settled' || group.latestBid.id !== winningBidEventId)

	for (const group of refundGroups) {
		const sourceBidIds = group.chain.map((bid) => bid.id)
		const existingRefundIds = await fetchExistingRefundEventIds(formData.auctionEventId, sellerPubkey, group.bidderPubkey, ndk)
		const alreadyRefunded = sourceBidIds.every((bidId) => existingRefundIds.has(bidId))

		if (!alreadyRefunded) {
			const envelopes = group.chain.map((bid) => {
				const envelope = envelopeByBidEventId.get(bid.id)
				if (!envelope) throw new Error(`Missing private bid token for refund bid ${bid.id}`)
				return envelope
			})

			for (const [index, envelope] of envelopes.entries()) {
				await redeemBidEnvelope(group.chain[index], envelope.amount, envelope.token)
			}

			const refundAmountsByMint = new Map<string, number>()
			for (const envelope of envelopes) {
				const mintUrl = normalizeMintUrl(envelope.mintUrl)
				refundAmountsByMint.set(mintUrl, (refundAmountsByMint.get(mintUrl) ?? 0) + envelope.amount)
			}

			const refunds: AuctionRefundTransfer[] = []
			for (const [mintUrl, amount] of Array.from(refundAmountsByMint.entries())) {
				const token = await nip60Actions.sendEcash(amount, mintUrl)
				if (!token) {
					throw new Error(`Failed to prepare ${amount} sat refund for ${group.bidderPubkey}`)
				}
				refunds.push({ mintUrl, amount, token })
			}

			await publishEncryptedAuctionTransfer({
				recipientPubkey: group.bidderPubkey,
				senderSigner: signer,
				ndk,
				tags: [
					['t', AUCTION_REFUND_TOPIC],
					['e', formData.auctionEventId],
					...(auctionCoordinates ? ([['a', auctionCoordinates]] as NDKTag[]) : []),
					...sourceBidIds.map((bidId) => ['e', bidId, '', AUCTION_REFUND_SOURCE_MARKER] as NDKTag),
				],
				content: {
					type: AUCTION_REFUND_TOPIC,
					auctionEventId: formData.auctionEventId,
					auctionCoordinates,
					sellerPubkey,
					recipientPubkey: group.bidderPubkey,
					sourceBidEventIds: sourceBidIds,
					refunds,
					createdAt: Date.now(),
				},
			})
		}

		settlementTags.push(['refund', group.latestBid.id, group.bidderPubkey, alreadyRefunded ? 'already_sent' : 'sent'])
	}

	const event = new NDKEvent(ndk)
	event.kind = AUCTION_SETTLEMENT_KIND
	event.content = JSON.stringify({
		type: 'auction_settlement',
		status: formData.status,
		winning_bid: winningBidEventId || null,
		winner: winnerPubkey || null,
		final_amount: finalAmount,
		winner_payout_amount: winnerPayoutAmount || null,
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
		...settlementTags,
	]
	if (auctionCoordinates) {
		event.tags.push(['a', auctionCoordinates])
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
