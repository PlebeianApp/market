import {
	AUCTION_BID_ENVELOPE_MARKER,
	AUCTION_BID_TOKEN_TOPIC,
	AUCTION_TRANSFER_DM_KIND,
	type AuctionBidTokenEnvelope,
} from '@/lib/auctionTransfers'
import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_SETTLEMENT_KIND,
	AuctionSettlementPublishStatus,
	getAuctionTagValue,
	type AuctionSettlementPlanResponse,
} from '@/lib/auctionSettlement'
import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import { AUCTION_SETTLEMENT_GRACE_SECONDS, nip60Actions, type AuctionP2pkKeyScheme } from '@/lib/stores/nip60'
import {
	normalizeProductShippingSelections,
	type ProductShippingSelection,
	type ProductShippingSelectionInput,
} from '@/lib/utils/productShippingSelections'
import { inspectAuctionP2pkPubkey, toCompressedAuctionP2pkPubkey } from '@/lib/auctionP2pk'
import { getBidAmount, getBidStatus, markAuctionAsDeleted } from '@/queries/auctions'
import { auctionKeys, orderKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, NDKUser, type NDKFilter, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'

const DEFAULT_AUCTION_MINT = 'https://nofees.testnut.cashu.space'

export interface AuctionSpecEntry {
	key: string
	value: string
}

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
	specs: AuctionSpecEntry[]
	shippings: ProductShippingSelectionInput[]
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
	escrowIdentityPubkey?: string
	p2pkXpub?: string
	mint?: string
}

export interface AuctionSettlementFormData {
	auctionEventId: string
	auctionCoordinates?: string
	status: AuctionSettlementPublishStatus
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

const getAuctionEscrowPubkeyOrThrow = (): string => {
	const appPubkey = configStore.state.config.appCashuPublicKey?.trim()
	if (!appPubkey) {
		throw new Error('App Cashu escrow pubkey is unavailable. Wait for app config to load and try again.')
	}
	return toCompressedAuctionP2pkPubkey(appPubkey)
}

const getAuctionEscrowIdentityPubkeyOrThrow = (): string => {
	const appPubkey = configStore.state.config.appPublicKey?.trim()
	if (!appPubkey) {
		throw new Error('App escrow identity pubkey is unavailable. Wait for app config to load and try again.')
	}
	return appPubkey
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
	const escrowPubkey = getAuctionEscrowPubkeyOrThrow()
	const escrowIdentityPubkey = getAuctionEscrowIdentityPubkeyOrThrow()
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

	const specTags: NDKTag[] = (formData.specs ?? [])
		.filter((spec) => spec && spec.key.trim() && spec.value.trim())
		.map((spec) => ['spec', spec.key.trim(), spec.value.trim()] as NDKTag)

	const normalizedShippings: ProductShippingSelection[] = normalizeProductShippingSelections(formData.shippings)
	const shippingTags: NDKTag[] = normalizedShippings.map((ship) =>
		ship.extraCost ? (['shipping_option', ship.shippingRef, ship.extraCost] as NDKTag) : (['shipping_option', ship.shippingRef] as NDKTag),
	)

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
		['escrow_identity', escrowIdentityPubkey],
		['key_scheme', keyScheme],
		['p2pk_xpub', p2pkXpub],
		['settlement_policy', 'cashu_p2pk_2of2_v1'],
		['schema', 'auction_v1'],
		...imageTags,
		...categoryTags,
		...specTags,
		...shippingTags,
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

const ACTIVE_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

const getFirstTagValue = getAuctionTagValue

const isSpentTokenError = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	return message.includes('already spent') || message.includes('token spent') || message.includes('proof not found')
}

const publishEncryptedAuctionTransfer = async (params: {
	recipientPubkey: string
	senderSigner: NDKSigner
	ndk: NDK
	tags: NDKTag[]
	content: AuctionBidTokenEnvelope
}): Promise<NDKEvent> => {
	const event = new NDKEvent(params.ndk)
	event.kind = AUCTION_TRANSFER_DM_KIND
	event.content = JSON.stringify(params.content)
	event.tags = [['p', params.recipientPubkey], ...params.tags]
	await event.encrypt(new NDKUser({ pubkey: params.recipientPubkey }), params.senderSigner, 'nip44')
	await event.sign(params.senderSigner)
	await ndkActions.publishEvent(event)
	return event
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

	const bidderWalletP2pk = await nip60Actions.getWalletCashuP2pk()
	const bidNonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	const locktime = Math.max(formData.auctionEndAt + AUCTION_SETTLEMENT_GRACE_SECONDS, now + 60)

	const lockedBid = await nip60Actions.lockAuctionBidFunds({
		amount: deltaAmount,
		mint: formData.mint || DEFAULT_BID_MINT,
		escrowPubkey: formData.escrowPubkey || formData.sellerPubkey,
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
		const transferTags: NDKTag[] = [
			['t', AUCTION_BID_TOKEN_TOPIC],
			['e', formData.auctionEventId],
			['e', event.id, '', AUCTION_BID_ENVELOPE_MARKER],
			['a', formData.auctionCoordinates],
			['mint', lockedBid.mintUrl],
			['commitment', lockedBid.commitment],
		]
		const transferContent: AuctionBidTokenEnvelope = {
			type: AUCTION_BID_TOKEN_TOPIC,
			auctionEventId: formData.auctionEventId,
			auctionCoordinates: formData.auctionCoordinates,
			bidEventId: event.id,
			bidderPubkey,
			sellerPubkey: formData.sellerPubkey,
			escrowPubkey: lockedBid.escrowPubkey,
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
		}
		const escrowIdentityPubkey = formData.escrowIdentityPubkey?.trim() || getAuctionEscrowIdentityPubkeyOrThrow()
		const transferRecipients = Array.from(new Set([formData.sellerPubkey, escrowIdentityPubkey]))
		for (const recipientPubkey of transferRecipients) {
			await publishEncryptedAuctionTransfer({
				recipientPubkey,
				senderSigner: signer,
				ndk,
				tags: transferTags,
				content: transferContent,
			})
		}
		await ndkActions.publishEvent(event)
		nip60Actions.updatePendingTokenContext(lockedBid.tokenId, {
			kind: 'auction_bid',
			auctionEventId: formData.auctionEventId,
			auctionCoordinates: formData.auctionCoordinates,
			bidEventId: event.id,
			sellerPubkey: formData.sellerPubkey,
			escrowPubkey: lockedBid.escrowPubkey,
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

	const auctionCoordinates =
		formData.auctionCoordinates ||
		(() => {
			const dTag = getFirstTagValue(auctionEvent, 'd')
			return dTag ? `30408:${auctionEvent.pubkey}:${dTag}` : ''
		})()
	const auctionP2pkXpub = getFirstTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!auctionP2pkXpub) {
		throw new Error('Auction is missing p2pk_xpub')
	}
	const walletAuctionXpub = await nip60Actions.getAuctionP2pkXpub()
	if (walletAuctionXpub !== auctionP2pkXpub) {
		throw new Error('Auction p2pk_xpub does not match the current wallet-derived auction HD root')
	}
	const settlementPlanResponse = await fetch('/api/auctions/settlement-plan', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			auctionEventId: formData.auctionEventId,
			auctionCoordinates,
			status: formData.status,
		}),
	})
	if (!settlementPlanResponse.ok) {
		const error = (await settlementPlanResponse.json().catch(() => null)) as { error?: string } | null
		throw new Error(error?.error || `Failed to prepare settlement plan (${settlementPlanResponse.status})`)
	}
	const settlementPlan = (await settlementPlanResponse.json()) as AuctionSettlementPlanResponse
	const closeAt = settlementPlan.closeAt || formData.closeAt || Math.floor(Date.now() / 1000)
	const winningBidEventId = settlementPlan.winningBidEventId || ''
	const winnerPubkey = settlementPlan.winnerPubkey || ''
	const finalAmount = Math.max(0, Math.floor(settlementPlan.finalAmount ?? 0))
	let winnerPayoutAmount = 0
	const settlementTags: NDKTag[] = []

	if (settlementPlan.status === 'settled') {
		if (!winningBidEventId || !winnerPubkey || finalAmount <= 0) {
			throw new Error('Settlement plan did not provide a valid winning bid')
		}
		for (const winnerToken of settlementPlan.winnerTokens) {
			console.log('[auction:settlement] winner token before seller receive', {
				bidEventId: winnerToken.bidEventId,
				amount: winnerToken.amount,
				totalBidAmount: winnerToken.totalBidAmount,
				derivationPath: winnerToken.derivationPath,
				childPubkey: inspectAuctionP2pkPubkey(winnerToken.childPubkey),
				refundPubkey: inspectAuctionP2pkPubkey(winnerToken.refundPubkey),
			})
			const childPrivkey = await nip60Actions.getAuctionHdChildPrivkey({
				derivationPath: winnerToken.derivationPath,
				expectedPubkey: winnerToken.childPubkey || undefined,
			})
			try {
				await nip60Actions.receiveLockedEcash(winnerToken.token, childPrivkey)
			} catch (error) {
				if (!isSpentTokenError(error)) throw error
			}
			winnerPayoutAmount += winnerToken.amount
		}
		if (winnerPayoutAmount !== finalAmount) {
			throw new Error(`Winning bid proofs total ${winnerPayoutAmount} sats, expected ${finalAmount} sats`)
		}
		settlementTags.push(['payout', winningBidEventId, String(winnerPayoutAmount), 'redeemed'])
	}

	const event = new NDKEvent(ndk)
	event.kind = AUCTION_SETTLEMENT_KIND
	event.content = JSON.stringify({
		type: 'auction_settlement',
		status: settlementPlan.status,
		winning_bid: winningBidEventId || null,
		winner: winnerPubkey || null,
		final_amount: finalAmount,
		winner_payout_amount: winnerPayoutAmount || null,
		reason: formData.reason || null,
	})
	event.tags = [
		['e', formData.auctionEventId],
		['status', settlementPlan.status],
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

// ---------------------------------------------------------------------------
// Auction Claim Order — winner submits shipping address after settlement
// ---------------------------------------------------------------------------

export interface AuctionClaimFormData {
	auctionEventId: string
	auctionCoordinates: string
	settlementEventId: string
	sellerPubkey: string
	finalAmount: number
	shippingAddress: {
		name: string
		firstLineOfAddress: string
		city: string
		zipPostcode: string
		country: string
		additionalInformation?: string
	}
	email?: string
	phone?: string
	notes?: string
}

/**
 * Creates a Kind 16 order event that references the won auction.
 * This is identical to a normal order creation but uses an `a` tag
 * pointing at the auction coordinate and an `e` tag pointing at the
 * settlement event instead of product `item` tags.
 */
export const publishAuctionClaimOrder = async (formData: AuctionClaimFormData): Promise<string> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No active user')

	const orderId = uuidv4()

	const addressParts = [
		formData.shippingAddress.name,
		formData.shippingAddress.firstLineOfAddress,
		formData.shippingAddress.additionalInformation,
		formData.shippingAddress.city,
		formData.shippingAddress.zipPostcode,
		formData.shippingAddress.country,
	].filter(Boolean)

	const tags: NDKTag[] = [
		['p', formData.sellerPubkey],
		['subject', `Auction claim for ${formData.auctionEventId.substring(0, 8)}`],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', orderId],
		['amount', String(formData.finalAmount)],
		// Link to auction & settlement
		['a', formData.auctionCoordinates],
		['e', formData.auctionEventId],
		['e', formData.settlementEventId, '', 'settlement'],
		['address', addressParts.join('\n')],
	]

	if (formData.email) tags.push(['email', formData.email])
	if (formData.phone) tags.push(['phone', formData.phone])
	if (formData.notes) tags.push(['notes', formData.notes])

	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.content = formData.notes || 'Auction win — shipping details enclosed'
	event.tags = tags

	await event.sign(signer)
	await ndkActions.publishEvent(event)

	return event.id
}

export const usePublishAuctionClaimOrderMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: publishAuctionClaimOrder,
		onSuccess: async (_orderId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.settlements(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: orderKeys.all })
			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: orderKeys.byBuyer(currentUserPubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.byPubkey(currentUserPubkey) })
			}
			toast.success('Shipping details submitted — the seller has been notified')
		},
		onError: (error) => {
			console.error('Failed to submit auction claim:', error)
			toast.error(`Failed to submit claim: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
