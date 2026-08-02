import type { ParsedAuctionEvent, ParsedBidEvent, ParsedSettlementEvent, ParsedPathReleaseEvent } from './events'
import type { AuctionSettlementStatus, Nut7ProofState } from './constants'
import type { NostrEventLike } from '../nostr/eventLike'
import { validateBid, validatePathRelease, validateSettlementCompleteness } from './validation'

export type SettlementParticipantRole = 'seller' | 'winning-bidder' | 'outbid-bidder' | 'non-participant'

export type SettlementPhase =
	| 'bidding-open'
	| 'settlement-window-open'
	| 'settlement-window-expired'
	| 'settled'
	| 'reserve-not-met'
	| 'cancelled'
	| 'closed'

export type SettlementTone = 'action' | 'waiting' | 'completed' | 'danger' | 'default'

export type SettlementIconKey = 'gavel' | 'check' | 'ban' | 'truck' | 'clock' | 'trophy' | 'alert'

export type SettlementCtaKind =
	| 'release-path'
	| 'submit-settlement'
	| 'close-auction'
	| 'view-order'
	| 'open-claim-dialog'
	| 'refresh-page'
	| 'none'

export interface SettlementCta {
	kind: Exclude<SettlementCtaKind, 'none'>
	label: string
	orderId?: string
	auctionRootEventId?: string
	auctionCoordinates?: string
	settlementEventId?: string
	sellerPubkey?: string
	finalAmount?: number
}

export interface SettlementDescriptor {
	role: SettlementParticipantRole
	phase: SettlementPhase
	title: string
	message: string
	tone: SettlementTone
	icon: SettlementIconKey
	cta: SettlementCta | null
	bidAmount: number
	verifiedBadge: 'none' | 'settlement' | 'path-release' | 'verifying'
}

export interface GetSettlementDescriptorInput {
	auction: ParsedAuctionEvent
	bids: ParsedBidEvent[]
	topBid: ParsedBidEvent | null
	settlements: ParsedSettlementEvent[]
	pathReleases: ParsedPathReleaseEvent[]
	claimOrders: NostrEventLike[]
	currentUserPubkey: string | undefined
	myTopBidEvent: ParsedBidEvent | null
	hasBidderRecord: boolean
	hasPlacedBid: boolean
	now: number
	topBidNut7State?: Nut7ProofState
}

interface DerivedState {
	ended: boolean
	settlementWindowExpired: boolean
	settlementLocktimeAt: number
	reserve: number
	hasReserve: boolean
	reserveMet: boolean
	latestSettlement: ParsedSettlementEvent | null
	hasLatestSettlement: boolean
	settlementStatus: AuctionSettlementStatus | 'unknown'
	settlementWinner: string
	settlementFinalAmount: number
	settlementNamesMe: boolean
	isMyBidTop: boolean
	myAlreadyReleased: boolean
	hasPathReleaseForTopBid: boolean
	matchedClaimOrderId: string | undefined
	hasMatchedClaimOrder: boolean
	validatedTopBid: ParsedBidEvent | null
	validatedBids: ParsedBidEvent[]
}

function isBidValid(auction: ParsedAuctionEvent, bid: ParsedBidEvent, nut7State?: Nut7ProofState, allBids?: ParsedBidEvent[]): boolean {
	// Compute replacement-chain leg amount if the bid references a previous bid.
	let bidChainLegAmount: number | undefined
	if (bid.prevBidId && allBids) {
		const prevBid = allBids.find((b) => b.id === bid.prevBidId)
		if (prevBid) bidChainLegAmount = bid.amount - prevBid.amount
	}

	const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State, bidChainLegAmount })
	if (verdict.claim === 'bid_invalid') {
		console.warn('[settlement] validateBid REJECTED bid', bid.id?.slice(0, 8), 'reason:', verdict.reason, 'detail:', verdict.detail)
	}
	return verdict.claim !== 'bid_invalid'
}

function isValidPathRelease(
	auction: ParsedAuctionEvent,
	bid: ParsedBidEvent,
	release: ParsedPathReleaseEvent,
	now: number,
	postCloseDecision: 'winner' | 'loser' | null,
): boolean {
	const result = validatePathRelease({ auction, bid, release, now, postCloseDecision })
	if (result.isValid) return true
	return false
}

function isPathReleaseFullyValid(
	auction: ParsedAuctionEvent,
	bid: ParsedBidEvent,
	release: ParsedPathReleaseEvent,
	now: number,
	postCloseDecision: 'winner' | 'loser' | null,
): boolean {
	const result = validatePathRelease({ auction, bid, release, now, postCloseDecision })
	return result.isValid
}

function isSettlementStructurallyValid(
	auction: ParsedAuctionEvent,
	settlement: ParsedSettlementEvent,
	topBid: ParsedBidEvent | null,
	validatedPathReleases: ParsedPathReleaseEvent[],
	rawPathReleases: ParsedPathReleaseEvent[],
	now: number,
	postCloseDecision: 'winner' | 'loser' | null,
	nut7State?: Nut7ProofState,
): boolean {
	if (settlement.sellerPubkey.toLowerCase() !== auction.sellerPubkey.toLowerCase()) return false
	if (settlement.auctionRootEventId !== auction.rootEventId || settlement.auctionCoordinate !== auction.coordinate) return false

	if (settlement.status !== 'settled' || !topBid) return true

	const matchingRelease = settlement.pathReleaseEventId
		? validatedPathReleases.find((pr) => pr.id === settlement.pathReleaseEventId)
		: validatedPathReleases.find((pr) => pr.bidEventId === topBid.id)

	const rawMatching = settlement.pathReleaseEventId
		? rawPathReleases.find((pr) => pr.id === settlement.pathReleaseEventId)
		: rawPathReleases.find((pr) => pr.bidEventId === topBid.id)

	if (rawMatching && !matchingRelease) return false

	if (!matchingRelease) return true

	if (!isPathReleaseFullyValid(auction, topBid, matchingRelease, now, postCloseDecision)) return true

	const result = validateSettlementCompleteness({
		auction,
		settlement,
		winningBid: topBid,
		pathRelease: matchingRelease,
		winningBidNut7State: nut7State,
	})

	if (result.isComplete) return true
	return result.failureCode === 'nut7_not_spent'
}

function deriveState(input: GetSettlementDescriptorInput): DerivedState {
	const {
		auction,
		topBid: rawTopBid,
		settlements: rawSettlements,
		pathReleases: rawPathReleases,
		claimOrders,
		currentUserPubkey,
		myTopBidEvent,
		now,
	} = input

	const biddingCutoffAt = auction.maxEndAt && auction.maxEndAt >= auction.endAt ? auction.maxEndAt : auction.endAt
	const settlementLocktimeAt = biddingCutoffAt > 0 && auction.settlementGrace > 0 ? biddingCutoffAt + auction.settlementGrace : 0
	const ended = biddingCutoffAt > 0 && now >= biddingCutoffAt
	const settlementWindowExpired = settlementLocktimeAt > 0 && now >= settlementLocktimeAt

	// 1. Validate the top bid — reject structurally invalid bids.
	const topBid = rawTopBid && isBidValid(auction, rawTopBid, input.topBidNut7State, input.bids) ? rawTopBid : null
	console.log(
		'[settlement] deriveState: rawTopBid=%s validatedTopBid=%s',
		rawTopBid?.id?.slice(0, 8) ?? 'null',
		topBid?.id?.slice(0, 8) ?? 'null',
	)

	// 2. Validate bids — filter to only structurally valid bids.
	const validatedBids = input.bids.filter((b) => isBidValid(auction, b, undefined, input.bids))

	// 3. Determine postCloseDecision from raw settlement data.
	const rawSettlementWinner = rawSettlements[0]?.winnerPubkey ?? ''
	const postCloseDecision: 'winner' | 'loser' | null = !ended
		? null
		: rawSettlementWinner && topBid && rawSettlementWinner !== topBid.bidderPubkey
			? 'loser'
			: 'winner'

	// 4. Validate path releases — filter to only structurally valid ones.
	const pathReleases = topBid ? rawPathReleases.filter((pr) => isValidPathRelease(auction, topBid, pr, now, postCloseDecision)) : []

	// 5. Validate settlements — filter to only structurally valid ones.
	const settlements = rawSettlements.filter((s) =>
		isSettlementStructurallyValid(auction, s, topBid, pathReleases, rawPathReleases, now, postCloseDecision, input.topBidNut7State),
	)

	const reserve = auction.reserve
	const hasReserve = reserve > 0
	const reserveMet = !!topBid && topBid.amount >= reserve

	const latestSettlement = settlements[0] ?? null
	const hasLatestSettlement = !!latestSettlement
	const settlementStatus = latestSettlement?.status ?? 'unknown'
	const settlementWinner = latestSettlement?.winnerPubkey ?? ''
	const settlementFinalAmount = latestSettlement?.finalAmount ?? 0
	const settlementNamesMe = !!currentUserPubkey && !!settlementWinner && settlementWinner === currentUserPubkey

	const isMyBidTop = !!(myTopBidEvent && topBid && myTopBidEvent.id === topBid.id)
	const myAlreadyReleased = !!myTopBidEvent && pathReleases.some((pr) => pr.bidEventId === myTopBidEvent.id)
	const hasPathReleaseForTopBid = !!topBid && pathReleases.some((pr) => pr.bidEventId === topBid.id)

	const matchedClaimOrderId = settlementNamesMe
		? claimOrders.find((o) => o.pubkey === currentUserPubkey)?.id
		: settlementWinner
			? claimOrders.find((o) => o.pubkey === settlementWinner)?.id
			: undefined
	const hasMatchedClaimOrder = !!matchedClaimOrderId

	return {
		ended,
		settlementWindowExpired,
		settlementLocktimeAt,
		reserve,
		hasReserve,
		reserveMet,
		latestSettlement,
		hasLatestSettlement,
		settlementStatus,
		settlementWinner,
		settlementFinalAmount,
		settlementNamesMe,
		isMyBidTop,
		myAlreadyReleased,
		hasPathReleaseForTopBid,
		matchedClaimOrderId,
		hasMatchedClaimOrder,
		validatedTopBid: topBid,
		validatedBids,
	}
}

function classifyRole(input: GetSettlementDescriptorInput, d: DerivedState): SettlementParticipantRole {
	const { auction, topBid, currentUserPubkey } = input
	if (!currentUserPubkey) return 'non-participant'
	if (currentUserPubkey === auction.sellerPubkey) return 'seller'
	if (d.validatedTopBid && d.validatedTopBid.bidderPubkey === currentUserPubkey) return 'winning-bidder'
	if (d.validatedBids.some((b) => b.bidderPubkey === currentUserPubkey)) return 'outbid-bidder'
	return 'non-participant'
}

function classifyPhase(d: DerivedState): SettlementPhase {
	if (!d.ended) return 'bidding-open'
	if (d.hasLatestSettlement) {
		switch (d.settlementStatus) {
			case 'settled':
				return 'settled'
			case 'reserve_not_met':
				return 'reserve-not-met'
			case 'cancelled':
			case 'griefed_no_fallback':
				return 'cancelled'
			default:
				return 'closed'
		}
	}
	return d.settlementWindowExpired ? 'settlement-window-expired' : 'settlement-window-open'
}

function build(
	role: SettlementParticipantRole,
	phase: SettlementPhase,
	title: string,
	message: string,
	tone: SettlementTone,
	icon: SettlementIconKey,
	cta: SettlementCta | null,
	bidAmount: number,
	verifiedBadge: SettlementDescriptor['verifiedBadge'],
): SettlementDescriptor {
	return { role, phase, title, message, tone, icon, cta, bidAmount, verifiedBadge }
}

const noCta: null = null

function cta(kind: SettlementCta['kind'], label: string, payload: Partial<SettlementCta> = {}): SettlementCta {
	return { kind, label, ...payload }
}

function sats(amount: number): string {
	return amount.toLocaleString()
}

export function getSettlementDescriptor(input: GetSettlementDescriptorInput): SettlementDescriptor | null {
	const d = deriveState(input)
	const role = classifyRole(input, d)
	const phase = classifyPhase(d)
	console.log(
		'[settlement] descriptor: role=%s phase=%s ended=%s reserveMet=%s hasTopBid=%s windowExpired=%s',
		role,
		phase,
		d.ended,
		d.reserveMet,
		!!d.validatedTopBid,
		d.settlementWindowExpired,
	)
	const { auction, myTopBidEvent, hasBidderRecord, hasPlacedBid } = input

	const claimDialogPayload = {
		auctionRootEventId: auction.rootEventId,
		auctionCoordinates: auction.coordinate,
		settlementEventId: d.latestSettlement?.id,
		sellerPubkey: auction.sellerPubkey,
		finalAmount: d.settlementFinalAmount,
	}

	const verifiedBadge: SettlementDescriptor['verifiedBadge'] = d.hasLatestSettlement
		? 'settlement'
		: d.hasPathReleaseForTopBid || d.myAlreadyReleased
			? 'path-release'
			: 'none'

	if (!d.ended) return null

	const now = input.now

	switch (role) {
		case 'seller': {
			if (d.hasLatestSettlement) {
				if (d.settlementStatus === 'settled') {
					if (d.hasMatchedClaimOrder) {
						return build(
							role,
							phase,
							'Order Received',
							'Winner has submitted shipping details. Process and ship the item.',
							'completed',
							'truck',
							cta('view-order', 'View Order', { orderId: d.matchedClaimOrderId }),
							0,
							verifiedBadge,
						)
					}
					return build(
						role,
						phase,
						'Awaiting Shipping Details',
						'Waiting for winner to submit shipping details.',
						'waiting',
						'clock',
						noCta,
						0,
						verifiedBadge,
					)
				}
				return build(
					role,
					phase,
					d.settlementStatus === 'reserve_not_met' ? 'Auction Closed — Reserve Not Met' : 'Auction Closed',
					d.settlementStatus === 'reserve_not_met'
						? 'The auction closed with no bid meeting the reserve. No settlement redemption occurred.'
						: 'This auction was closed without a settled winner.',
					'completed',
					'ban',
					noCta,
					0,
					verifiedBadge,
				)
			}

			if (d.hasPathReleaseForTopBid) {
				return build(
					role,
					phase,
					'Settlement Ready',
					'Complete settlement by publishing the settlement event.',
					'action',
					'gavel',
					cta('submit-settlement', 'Publish Settlement'),
					0,
					verifiedBadge,
				)
			}

			if (!d.reserveMet) {
				return build(
					role,
					phase,
					d.hasReserve ? 'Reserve Not Met' : 'No Bids Received',
					d.hasReserve
						? 'No bid met the reserve price. Close the auction to publish a reserve_not_met settlement.'
						: 'This auction received no bids. Close the auction to finalize it.',
					'action',
					'ban',
					cta('close-auction', 'Close Auction'),
					0,
					verifiedBadge,
				)
			}

			if (d.settlementWindowExpired) {
				return build(
					role,
					phase,
					'Settlement Window Expired',
					'The settlement window closed without a path release from the winning bidder. No settlement can be published; the bidder\u2019s locked proofs will refund at locktime.',
					'completed',
					'ban',
					noCta,
					0,
					verifiedBadge,
				)
			}
			return build(
				role,
				phase,
				'Awaiting Path Release',
				'Waiting for the winning bidder to release their path.',
				'waiting',
				'clock',
				noCta,
				0,
				verifiedBadge,
			)
		}

		case 'winning-bidder': {
			if (d.hasLatestSettlement) {
				if (d.settlementStatus === 'settled') {
					if (d.settlementNamesMe) {
						if (d.hasMatchedClaimOrder) {
							return build(
								role,
								phase,
								'You won this auction!',
								`Shipping details submitted — awaiting seller. Final price: ${sats(d.settlementFinalAmount)} sats`,
								'completed',
								'check',
								cta('view-order', 'View Order', { orderId: d.matchedClaimOrderId }),
								d.settlementFinalAmount,
								verifiedBadge,
							)
						}
						return build(
							role,
							phase,
							'You won this auction!',
							`Final price: ${sats(d.settlementFinalAmount)} sats`,
							'action',
							'trophy',
							cta('open-claim-dialog', 'Submit Shipping Address', claimDialogPayload),
							d.settlementFinalAmount,
							verifiedBadge,
						)
					}
					return build(
						role,
						phase,
						'Settlement Went to Fallback',
						'A fallback bidder was selected for settlement. Your locked proofs will refund at locktime.',
						'completed',
						'ban',
						noCta,
						myTopBidEvent?.amount ?? 0,
						verifiedBadge,
					)
				}
				if (d.settlementStatus === 'reserve_not_met') {
					return refundDescriptor(role, phase, d, now, verifiedBadge)
				}
				if (d.settlementStatus === 'cancelled' || d.settlementStatus === 'griefed_no_fallback') {
					return build(
						role,
						phase,
						'Auction Closed',
						'This auction was closed without a settled winner. Your locked proofs will refund at locktime.',
						'completed',
						'ban',
						noCta,
						myTopBidEvent?.amount ?? 0,
						verifiedBadge,
					)
				}
				return null
			}

			if (!myTopBidEvent) return null

			if (d.myAlreadyReleased) {
				return build(
					role,
					phase,
					'Path release published',
					'Waiting for seller to redeem and publish settlement.',
					'waiting',
					'check',
					noCta,
					0,
					verifiedBadge,
				)
			}

			if (d.settlementWindowExpired) {
				return build(
					role,
					phase,
					'Settlement Expired',
					'The settlement window closed without your path release. Your locked proofs will refund at locktime.',
					'completed',
					'ban',
					noCta,
					myTopBidEvent.amount,
					verifiedBadge,
				)
			}

			if (!hasBidderRecord) {
				return build(
					role,
					phase,
					'Local Record Missing',
					'Cannot find the release path for the bid. Refreshing the page to reload wallet data may help - otherwise the bid may have been placed from another browser or device.',
					'completed',
					'ban',
					cta('refresh-page', 'Refresh Page'),
					0,
					verifiedBadge,
				)
			}

			if (d.reserveMet) {
				const amount = myTopBidEvent.amount
				return build(
					role,
					phase,
					'You won — release your path to settle',
					`Bid: ${sats(amount)} sats. Publishing your kind-1025 reveals the derivation path so the seller can redeem your locked proofs.`,
					'action',
					'gavel',
					cta('release-path', 'Release path & settle'),
					amount,
					verifiedBadge,
				)
			}

			return build(
				role,
				phase,
				'Reserve Not Met',
				'Your top bid did not meet the reserve. Your locked proofs will refund at locktime.',
				'waiting',
				'clock',
				noCta,
				myTopBidEvent.amount,
				verifiedBadge,
			)
		}

		case 'outbid-bidder': {
			if (!myTopBidEvent && hasPlacedBid) {
				return build(
					role,
					phase,
					'Bid Not Validated',
					'Your bid did not pass auction validation and is not counted. No funds are locked from this bid.',
					'completed',
					'alert',
					noCta,
					0,
					verifiedBadge,
				)
			}
			if (d.hasLatestSettlement && d.settlementStatus === 'reserve_not_met') {
				return refundDescriptor(role, phase, d, now, verifiedBadge)
			}
			return null
		}

		case 'non-participant': {
			if (!myTopBidEvent && hasPlacedBid) {
				return build(
					role,
					phase,
					'Bid Not Validated',
					'Your bid did not pass auction validation and is not counted. No funds are locked from this bid.',
					'completed',
					'alert',
					noCta,
					0,
					verifiedBadge,
				)
			}

			// Outside-observer transparency states
			if (d.hasLatestSettlement) {
				if (d.settlementStatus === 'settled') {
					return build(
						role,
						phase,
						'Auction Settled',
						d.settlementFinalAmount > 0
							? `This auction settled for ${sats(d.settlementFinalAmount)} sats.`
							: 'This auction has been settled.',
						'completed',
						'check',
						noCta,
						0,
						verifiedBadge,
					)
				}
				return build(
					role,
					phase,
					d.settlementStatus === 'reserve_not_met' ? 'Auction Closed — Reserve Not Met' : 'Auction Closed',
					d.settlementStatus === 'reserve_not_met'
						? 'The auction closed with no bid meeting the reserve.'
						: 'This auction was closed without a settled winner.',
					'completed',
					'ban',
					noCta,
					0,
					verifiedBadge,
				)
			}

			if (d.hasPathReleaseForTopBid) {
				return build(
					role,
					phase,
					'Settlement in Process',
					'The winning bidder has released their path. Waiting for the seller to redeem and publish settlement.',
					'waiting',
					'clock',
					noCta,
					0,
					verifiedBadge,
				)
			}

			if (d.settlementWindowExpired) {
				return build(
					role,
					phase,
					'Settlement Window Expired',
					'The settlement window closed without a path release from the winning bidder.',
					'completed',
					'ban',
					noCta,
					0,
					verifiedBadge,
				)
			}

			if (d.reserveMet || (!d.hasReserve && d.validatedTopBid)) {
				return build(
					role,
					phase,
					'Awaiting Settlement',
					'The auction ended with a winning bid. Waiting for the bidder to release their path.',
					'waiting',
					'clock',
					noCta,
					0,
					verifiedBadge,
				)
			}

			return build(
				role,
				phase,
				d.hasReserve ? 'Reserve Not Met' : 'Auction Ended',
				d.hasReserve ? 'No bid met the reserve price.' : 'This auction received no qualifying bids.',
				'completed',
				'ban',
				noCta,
				0,
				verifiedBadge,
			)
		}

		default:
			return null
	}
}

function refundDescriptor(
	role: SettlementParticipantRole,
	phase: SettlementPhase,
	d: DerivedState,
	now: number,
	verifiedBadge: SettlementDescriptor['verifiedBadge'],
): SettlementDescriptor {
	const refundReady = d.settlementLocktimeAt > 0 && now >= d.settlementLocktimeAt
	if (refundReady) {
		return build(
			role,
			phase,
			'Refund Ready',
			'Refund window opened - verify the unlocked funds have returned to your wallet.',
			'completed',
			'check',
			noCta,
			0,
			verifiedBadge,
		)
	}
	return build(role, phase, 'Refund Pending', 'Refund window opens soon.', 'waiting', 'clock', noCta, 0, verifiedBadge)
}
