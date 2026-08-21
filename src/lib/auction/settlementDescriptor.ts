import { isStructurallyValidSettledSettlement } from './events'
import type {
	ParsedAuctionEvent,
	ParsedBidEvent,
	ParsedSettlementEvent,
	ParsedPathReleaseEvent,
	ParsedValidatorVerdictEvent,
} from './events'
import type { AuctionSettlementStatus, Nut7ProofState } from './constants'
import type { NostrEventLike } from '../nostr/eventLike'
import type { MintKeyset } from '@cashu/cashu-ts'
import { validatePathRelease, validateSettlementCompleteness, fetchMintKeysets } from './validation'
import { computeValidatedBids } from './bidValidation'
import type { SettlementChainLegContext } from './validation'

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
	verifiedBadge: 'none' | 'settlement' | 'settlement-pending-redemption' | 'path-release' | 'verifying'
}

export interface GetSettlementDescriptorInput {
	auction: ParsedAuctionEvent
	bids: ParsedBidEvent[]
	verdicts: ParsedValidatorVerdictEvent[]
	settlements: ParsedSettlementEvent[]
	pathReleases: ParsedPathReleaseEvent[]
	claimOrders: NostrEventLike[]
	currentUserPubkey: string | undefined
	myTopBidEvent: ParsedBidEvent | null
	hasBidderRecord: boolean
	hasPlacedBid: boolean
	now: number
	/**
	 * NUT-7 proof states from the client's own `checkProofStateBatch` query,
	 * keyed by bid event id. When absent, bids fall back to `bid_pending_review`.
	 */
	nut7States?: Map<string, Nut7ProofState>
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
	isSettlementPending: boolean
	/**
	 * True when the settlement is structurally valid but the winning bid's
	 * proofs are NOT confirmed `spent` at the mint (the seller hasn't
	 * redeemed yet). The settlement is accepted but redemption is pending.
	 * Used to show `settlement-pending-redemption` badge instead of the
	 * full `settlement` badge.
	 */
	isSettlementPendingRedemption: boolean
	isMyBidTop: boolean
	myAlreadyReleased: boolean
	hasPathReleaseForTopBid: boolean
	matchedClaimOrderId: string | undefined
	hasMatchedClaimOrder: boolean
	validatedTopBid: ParsedBidEvent | null
	validatedBids: ParsedBidEvent[]
}

function isValidPathRelease(
	auction: ParsedAuctionEvent,
	bid: ParsedBidEvent,
	release: ParsedPathReleaseEvent,
	now: number,
	postCloseDecision: 'winner' | 'loser' | null,
	mintKeysets?: MintKeyset[],
): boolean {
	const result = validatePathRelease({ auction, bid, release, now, postCloseDecision, mintKeysets })
	return result.isValid
}

type SettlementValidity = 'valid' | 'pending' | 'invalid'

function isSettlementStructurallyValid(
	auction: ParsedAuctionEvent,
	settlement: ParsedSettlementEvent,
	topBid: ParsedBidEvent | null,
	validatedBids: ParsedBidEvent[],
	validatedPathReleases: ParsedPathReleaseEvent[],
	rawPathReleases: ParsedPathReleaseEvent[],
	now: number,
	postCloseDecision: 'winner' | 'loser' | null,
	nut7State?: Nut7ProofState,
	mintKeysets?: MintKeyset[],
): SettlementValidity {
	if (settlement.sellerPubkey.toLowerCase() !== auction.sellerPubkey.toLowerCase()) return 'invalid'
	if (settlement.auctionRootEventId !== auction.rootEventId || settlement.auctionCoordinate !== auction.coordinate) return 'invalid'

	// Non-settled statuses: verify based on status type
	if (settlement.status !== 'settled') {
		// B3: cancelled and reserve_not_met must not be 'valid' when a
		// reserve-meeting bid exists. A seller cannot displace a
		// reserve-meeting canonical winner with these statuses.
		if (settlement.status === 'cancelled' || settlement.status === 'reserve_not_met') {
			const hasReserveMeetingBid = validatedBids.some((b) => b.amount >= auction.reserve)
			if (hasReserveMeetingBid) return 'invalid'
		}
		// cancelled: seller signature + root event ID + coordinate = sufficient
		if (settlement.status === 'cancelled') return 'valid'
		// reserve_not_met and griefed_no_fallback: basic structural checks pass
		// (deeper cross-checks with computeValidatedBids are handled in deriveState)
		return 'valid'
	}

	// settled status requires a valid top bid
	if (!topBid) return 'invalid'

	const matchingRelease = settlement.pathReleaseEventId
		? validatedPathReleases.find((pr) => pr.id === settlement.pathReleaseEventId)
		: validatedPathReleases.find((pr) => pr.bidEventId === topBid.id)

	const rawMatching = settlement.pathReleaseEventId
		? rawPathReleases.find((pr) => pr.id === settlement.pathReleaseEventId)
		: rawPathReleases.find((pr) => pr.bidEventId === topBid.id)

	// Raw release exists but was filtered out as invalid → fraudulent release
	if (rawMatching && !matchingRelease) return 'invalid'

	// No matching release yet → may not have arrived
	if (!matchingRelease) return 'pending'

	if (!isValidPathRelease(auction, topBid, matchingRelease, now, postCloseDecision, mintKeysets)) return 'invalid'

	// Build the bid chain by walking prevBidId links from the top bid.
	// This lets validateSettlementCompleteness know about all legs so it
	// can validate the correct number of payout tags.
	const bidChain: SettlementChainLegContext[] = []
	let current: ParsedBidEvent | undefined = topBid
	const chainBids: ParsedBidEvent[] = []
	while (current) {
		chainBids.unshift(current)
		current = current.prevBidId ? validatedBids.find((b) => b.id === current!.prevBidId) : undefined
	}
	for (const bid of chainBids) {
		const release = validatedPathReleases.find((pr) => pr.bidEventId === bid.id)
		if (release) {
			bidChain.push({ bid, pathRelease: release, nut7State })
		}
	}

	// Check chain integrity: every leg in the chain must have a path release
	// (don't shrink the chain — a partial chain is invalid)
	if (chainBids.length > 0 && bidChain.length !== chainBids.length) return 'invalid'

	const result = validateSettlementCompleteness({
		auction,
		settlement,
		winningBid: topBid,
		pathRelease: matchingRelease,
		winningBidNut7State: nut7State,
		mintKeysets,
		bidChain: bidChain.length > 0 ? bidChain : undefined,
	})

	if (result.isComplete) return 'valid'

	// A structurally valid settlement (correct seller, winning bid, path
	// release, payouts) that fails ONLY on NUT-7 spend state is still
	// 'valid' — the settlement event is the seller's declaration of
	// redemption; NUT-7 spend is fraud-detection evidence (has the seller
	// actually redeemed?), not a validity gate for the settlement
	// declaration. The seller publishes the settlement BEFORE redeeming,
	// so requiring spent proofs at settlement time would leave the
	// settlement stuck in 'verifying' until redemption completes.
	if (result.failureCode === 'nut7_not_spent') return 'valid'
	return 'invalid'
}

function readEventTag(tags: string[][], name: string): string | undefined {
	const tag = tags.find((t) => t[0] === name)
	return tag?.[1]
}

function readSettlementEventTag(tags: string[][]): string | undefined {
	const tag = tags.find((t) => t[0] === 'e' && t[3] === 'settlement')
	return tag?.[1]
}

function readAuctionEventTag(tags: string[][]): string | undefined {
	const tag = tags.find((t) => t[0] === 'e' && t[3] !== 'settlement')
	return tag?.[1]
}

/**
 * Validate a kind-16 claim order against the auction + settlement.
 * Returns the claim order id if valid, undefined otherwise.
 *
 * 8-point validation:
 * 1. Claim order's `p` tag (seller) matches auction.sellerPubkey
 * 2. Claim order's `a` tag (coordinate) matches the auction's coordinate
 * 3. Claim order has a settlement_event `e` tag with 'settlement' marker
 * 4. The referenced settlement event is in the validated settlements list
 * 5. Claim order's pubkey (buyer) matches the settlement's winnerPubkey
 * 6. Claim order's `amount` tag matches the settlement's finalAmount
 * 7. Claim order's auction `e` tag matches the auction root event id
 * 8. Claim order pubkey is a valid 64-char hex (inherent in Nostr)
 */
function validateClaimOrder(
	order: NostrEventLike,
	auction: ParsedAuctionEvent,
	validatedSettlements: ParsedSettlementEvent[],
	auctionRootEventId: string,
): boolean {
	const tags = order.tags ?? []
	// 1. Seller pubkey match
	const sellerP = readEventTag(tags, 'p')
	if (sellerP !== auction.sellerPubkey) return false
	// 2. Auction coordinate match
	const coordinate = readEventTag(tags, 'a')
	if (coordinate !== auction.coordinate) return false
	// 3. Settlement event tag exists
	const settlementEventId = readSettlementEventTag(tags)
	if (!settlementEventId) return false
	// 4. Referenced settlement is in validated list
	const settlement = validatedSettlements.find((s) => s.id === settlementEventId)
	if (!settlement) return false
	// 5. Buyer pubkey matches settlement winner
	if (order.pubkey !== settlement.winnerPubkey) return false
	// 6. Amount matches settlement finalAmount
	const amountStr = readEventTag(tags, 'amount')
	const amount = amountStr ? parseInt(amountStr, 10) : NaN
	if (!Number.isFinite(amount) || amount !== (settlement.finalAmount ?? 0)) return false
	// 7. Auction event id matches root
	const auctionEventId = readAuctionEventTag(tags)
	if (auctionEventId !== auctionRootEventId) return false
	// 8. Pubkey is valid hex (inherent — Nostr events have valid pubkeys)
	return true
}

function deriveState(
	input: GetSettlementDescriptorInput,
	mintKeysets?: MintKeyset[],
	// Optional pre-computed validated-bid set — getSettlementDescriptor
	// computes it once and passes it in instead of re-computing.
	preValidated?: import('./bidValidation').ValidatedBidSet,
): DerivedState {
	const {
		auction,
		bids,
		verdicts,
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

	// Settlement-aware NUT-7 spend masking (#11): `spent` is fraud before the
	// seller settles, but 'seller already redeemed' after a valid `settled`
	// settlement exists. Only treat `spent` as benign when a structurally-valid
	// `settled` settlement is present (correct seller + auction refs).
	const settledBidIds = new Set<string>()
	for (const s of rawSettlements) {
		if (!isStructurallyValidSettledSettlement(s, auction)) continue
		if (s.winningBidId) settledBidIds.add(s.winningBidId)
		for (const p of s.payouts ?? []) settledBidIds.add(p.bidEventId)
	}
	const hasSettledSettlement = settledBidIds.size > 0

	// 1. Validated bids — reuse the caller's pre-computed set when provided
	// (avoids a duplicate validation pass per descriptor invocation, which
	// this view re-runs on every ticking `now` update).
	const validatedBidSet =
		preValidated ??
		computeValidatedBids({
			auction,
			bids,
			verdicts,
			nut7States: input.nut7States,
			postSettlement: hasSettledSettlement,
			settledBidIds,
		})
	const topBid = validatedBidSet.canonicalWinner
	const validatedBids = validatedBidSet.validBids

	// 2. Determine postCloseDecision from structurally pre-filtered settlements.
	// M1 FIX: The original code used rawSettlements[0]?.winnerPubkey directly,
	// which could be a fraudulent settlement from an arbitrary pubkey. An
	// attacker could publish a settlement with a different winnerPubkey to
	// poison postCloseDecision to 'loser', which would then reject the
	// legitimate winner's path release in step 3. Instead, we first filter
	// to settlements that pass basic structural checks (correct seller,
	// auction refs), then pick the latest by createdAt deterministically.
	const structurallyPrefilteredSettlements = rawSettlements
		.filter(
			(s) =>
				s.sellerPubkey.toLowerCase() === auction.sellerPubkey.toLowerCase() &&
				s.auctionRootEventId === auction.rootEventId &&
				s.auctionCoordinate === auction.coordinate,
		)
		.sort((a, b) => b.createdAt - a.createdAt)
	const prefilteredWinner = structurallyPrefilteredSettlements[0]?.winnerPubkey ?? ''
	const postCloseDecision: 'winner' | 'loser' | null = !ended
		? null
		: prefilteredWinner && topBid && prefilteredWinner !== topBid.bidderPubkey
			? 'loser'
			: 'winner'

	// 3. Validate path releases — filter to only structurally valid ones.
	// For rebid chains, each path release must be validated against its own bid,
	// not the top bid. A path release for leg 1 has leg 1's childPubkey and
	// proofs, which won't match the top bid (leg 2) — that's expected.
	const pathReleases = topBid
		? rawPathReleases.filter((pr) => {
				// Optimistic UI (ADR-0004 Decision 4): a locally-synthesized
				// release is marked `synthetic: true` by the component that
				// constructs it (an explicit, non-forgeable flag — relay-sourced
				// ids are NOT trusted for this, since they aren't
				// signature/hash-verified in this fetch pipeline and an attacker
				// could forge an id prefix). It originates from the current
				// user's own publish action, so skip validation for it —
				// otherwise `myAlreadyReleased` stays false and the UI does not
				// flip to 'Path release published'.
				if ((pr as { synthetic?: boolean }).synthetic === true) return true
				const matchingBid = validatedBids.find((b) => b.id === pr.bidEventId)
				const bidToValidate = matchingBid ?? topBid
				const result = isValidPathRelease(auction, bidToValidate, pr, now, postCloseDecision, mintKeysets)
				return result
			})
		: []

	// 4. Validate settlements — filter out invalid ones, keep valid and pending.
	const settlementValidities = new Map<string, SettlementValidity>()
	const settlements = rawSettlements.filter((s) => {
		const validity = isSettlementStructurallyValid(
			auction,
			s,
			topBid,
			validatedBids,
			pathReleases,
			rawPathReleases,
			now,
			postCloseDecision,
			input.nut7States?.get(topBid?.id ?? ''),
			mintKeysets,
		)
		settlementValidities.set(s.id, validity)
		return validity !== 'invalid'
	})

	const reserve = auction.reserve
	const hasReserve = reserve > 0
	const reserveMet = !!topBid && topBid.amount >= reserve

	// Prefer 'settled' over 'reserve_not_met' (a settled event redeems proofs
	// and cannot be overridden by a later reserve_not_met). Among same-status
	// events, prefer the latest by created_at. Prefer 'valid' over 'pending'.
	// B3: Never let reserve_not_met displace settled — a pending settled
	// always beats a valid non-settled, regardless of validity ordering.
	const latestSettlement = settlements.length
		? settlements.reduce((best, s) => {
				const bestValidity = settlementValidities.get(best.id) ?? 'valid'
				const sValidity = settlementValidities.get(s.id) ?? 'valid'
				// B3: Settled always wins over non-settled, even when settled is
				// pending and the other is valid.
				if (s.status === 'settled' && best.status !== 'settled') return s
				if (best.status === 'settled' && s.status !== 'settled') return best
				if (sValidity === 'valid' && bestValidity === 'pending') return s
				if (sValidity === 'pending' && bestValidity === 'valid') return best
				if (s.status === best.status && s.createdAt > best.createdAt) return s
				return best
			})
		: null
	const hasLatestSettlement = !!latestSettlement
	const settlementStatus = latestSettlement?.status ?? 'unknown'
	const settlementWinner = latestSettlement?.winnerPubkey ?? ''
	const settlementFinalAmount = latestSettlement?.finalAmount ?? 0
	const settlementNamesMe = !!currentUserPubkey && !!settlementWinner && settlementWinner === currentUserPubkey
	const isSettlementPending = latestSettlement ? settlementValidities.get(latestSettlement.id) === 'pending' : false

	// Whether the winning bid's proofs are confirmed `spent` at the mint.
	// When the settlement is valid but proofs aren't spent yet (the seller
	// hasn't redeemed), show a distinct badge (`settlement-pending-redemption`)
	// rather than the full `settlement` badge.
	const winnerNut7State = topBid ? input.nut7States?.get(topBid.id) : undefined
	const isSettlementPendingRedemption =
		hasLatestSettlement && settlementStatus === 'settled' && !isSettlementPending && winnerNut7State !== 'spent'

	const isMyBidTop = !!(myTopBidEvent && topBid && myTopBidEvent.id === topBid.id)
	const myAlreadyReleased = !!myTopBidEvent && pathReleases.some((pr) => pr.bidEventId === myTopBidEvent.id)
	const hasPathReleaseForTopBid = !!topBid && pathReleases.some((pr) => pr.bidEventId === topBid.id)

	// Match claim orders using 8-point validation instead of simple pubkey match.
	// For seller view: match any claim order that validates against the latest settlement.
	// For bidder view: match claim orders signed by the current user that validate.
	const validatedClaimOrderIds = claimOrders
		.filter((o) => validateClaimOrder(o, auction, settlements, auction.rootEventId))
		.map((o) => o.id)
	const targetClaimPubkey = settlementNamesMe ? currentUserPubkey : settlementWinner
	const matchedClaimOrderId = validatedClaimOrderIds.find((id) => claimOrders.find((o) => o.id === id)?.pubkey === targetClaimPubkey)
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
		isSettlementPending,
		isSettlementPendingRedemption,
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
	const { auction, currentUserPubkey } = input
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

export async function getSettlementDescriptor(input: GetSettlementDescriptorInput): Promise<SettlementDescriptor | null> {
	// Settlement-aware NUT-7 spend masking (#11): `spent` is fraud before the
	// seller settles, but 'seller already redeemed' after a valid `settled`
	// settlement exists. Only treat `spent` as benign when a structurally-valid
	// `settled` settlement is present (correct seller + auction refs).
	const settledBidIds = new Set<string>()
	for (const s of input.settlements) {
		if (!isStructurallyValidSettledSettlement(s, input.auction)) continue
		if (s.winningBidId) settledBidIds.add(s.winningBidId)
		for (const p of s.payouts ?? []) settledBidIds.add(p.bidEventId)
	}
	const hasSettledSettlement = settledBidIds.size > 0

	// Compute validated bids early so we can fetch keysets for the canonical winner.
	const preValidated = computeValidatedBids({
		auction: input.auction,
		bids: input.bids,
		verdicts: input.verdicts,
		nut7States: input.nut7States,
		postSettlement: hasSettledSettlement,
		settledBidIds,
	})
	const winnerBid = preValidated.canonicalWinner
	const mintKeysets = winnerBid ? await fetchMintKeysets(winnerBid.mint) : undefined
	const d = deriveState(input, mintKeysets, preValidated)
	const role = classifyRole(input, d)
	const phase = classifyPhase(d)
	const { auction, myTopBidEvent, hasBidderRecord, hasPlacedBid } = input

	const claimDialogPayload = {
		auctionRootEventId: auction.rootEventId,
		auctionCoordinates: auction.coordinate,
		settlementEventId: d.latestSettlement?.id,
		sellerPubkey: auction.sellerPubkey,
		finalAmount: d.settlementFinalAmount,
	}

	const verifiedBadge: SettlementDescriptor['verifiedBadge'] = d.hasLatestSettlement
		? d.isSettlementPending
			? 'verifying'
			: d.isSettlementPendingRedemption
				? 'settlement-pending-redemption'
				: 'settlement'
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
				if (d.settlementWindowExpired) {
					return build(
						role,
						phase,
						'Late Settlement (Best-Effort)',
						'The settlement window has expired. The winning bidder can now claim a refund. Publishing a settlement may still succeed but is not guaranteed.',
						'action',
						'gavel',
						cta('submit-settlement', 'Publish Settlement'),
						0,
						verifiedBadge,
					)
				}
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
					'Your bid did not pass auction validation and is not counted. Downstream validation failure does not prove the Cashu lock is absent — verify wallet state separately.',
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
					'Your bid did not pass auction validation and is not counted. Downstream validation failure does not prove the Cashu lock is absent — verify wallet state separately.',
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
