import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useStore } from '@tanstack/react-store'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { authStore } from '@/lib/stores/auth'
import { cn } from '@/lib/utils'
import { findBidderRecord } from '@/lib/auction/bidderRecords'
import { nip60Actions } from '@/lib/stores/nip60'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { auctionKeys } from '@/queries/queryKeyFactory'
import { usePublishAuctionSettlementMutation, type AuctionSettlementFormData } from '@/publish/auctions'
import {
	getSettlementDescriptor,
	type GetSettlementDescriptorInput,
	type SettlementCtaKind,
	type SettlementDescriptor,
	type SettlementIconKey,
} from '@/lib/auction/settlementDescriptor'
import { useNut7Polling } from '@/lib/auction/useNut7Polling'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import type {
	ParsedAuctionEvent,
	ParsedBidEvent,
	ParsedPathReleaseEvent,
	ParsedSettlementEvent,
	ParsedValidatorVerdictEvent,
} from '@/lib/auction/events'
import { Clock, CheckCircle, Ban, Truck, Gavel, Trophy, BadgeCheck, AlertTriangle } from 'lucide-react'
import { AuctionClaimDialog } from './AuctionClaimDialog'
import { useNavigate } from '@tanstack/react-router'

function useNow(intervalMs = 30_000): number {
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
	useEffect(() => {
		const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
		return () => clearInterval(id)
	}, [intervalMs])
	return now
}

const ICON_REGISTRY: Record<SettlementIconKey, ReactElement> = {
	gavel: <Gavel className="w-5 h-5 text-sky-300" />,
	check: <CheckCircle className="w-5 h-5 text-emerald-300" />,
	ban: <Ban className="w-5 h-5 text-red-300" />,
	truck: <Truck className="w-5 h-5 text-emerald-300" />,
	clock: <Clock className="w-5 h-5 text-blue-300" />,
	trophy: <Trophy className="w-5 h-5 text-emerald-300" />,
	alert: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
}

const TONE_CLASSES: Record<SettlementDescriptor['tone'], string> = {
	action: 'border-amber-100 bg-amber-50/30',
	waiting: 'border-blue-100 bg-blue-50/30',
	completed: 'border-green-100 bg-green-50/30',
	danger: 'border-red-100 bg-red-50/30',
	default: '',
}

export interface AuctionSettlementProps {
	auction: ParsedAuctionEvent
	bids: ParsedBidEvent[]
	verdicts: ParsedValidatorVerdictEvent[]
	settlements: ParsedSettlementEvent[]
	pathReleases: ParsedPathReleaseEvent[]
	claimOrders: NostrEventLike[]
	hasPlacedBid: boolean
	auctionRootEventId: string
	auctionCoordinates: string
	className?: string
}

export function AuctionSettlement({
	auction,
	bids,
	verdicts,
	settlements,
	pathReleases,
	claimOrders,
	hasPlacedBid,
	auctionRootEventId,
	auctionCoordinates,
	className,
}: AuctionSettlementProps) {
	const { user } = useStore(authStore)
	const currentUserPubkey = user?.pubkey
	const [isClaimDialogOpen, setIsClaimDialogOpen] = useState(false)
	const navigate = useNavigate()
	const now = useNow()
	const queryClient = useQueryClient()
	const settlementMutation = usePublishAuctionSettlementMutation()
	const [isReleasing, setIsReleasing] = useState(false)

	const biddingCutoffAt = auction.maxEndAt >= auction.endAt ? auction.maxEndAt : auction.endAt
	const ended = biddingCutoffAt > 0 && now >= biddingCutoffAt

	const myTopBidEvent = useMemo(() => {
		if (!currentUserPubkey || !bids.length) return null
		const myBids = bids.filter((b) => b.bidderPubkey === currentUserPubkey)
		if (!myBids.length) return null
		return myBids.reduce((best, bid) => {
			const delta = bid.amount - best.amount
			if (delta > 0) return bid
			if (delta < 0) return best
			return bid.createdAt < best.createdAt ? bid : best
		}, myBids[0])
	}, [bids, currentUserPubkey])

	const myBidderRecord = useMemo(() => (myTopBidEvent ? findBidderRecord(myTopBidEvent.id) : null), [myTopBidEvent])

	// Optimistic path release — ADR-0004 Decision 4
	const optimisticReleaseRef = useRef<ParsedPathReleaseEvent | null>(null)
	const [optimisticRelease, setOptimisticRelease] = useState<ParsedPathReleaseEvent | null>(null)

	const pathReleasesForDescriptor = useMemo(() => {
		if (!optimisticRelease) return pathReleases
		if (pathReleases.some((pr) => pr.bidEventId === optimisticRelease.bidEventId)) return pathReleases
		return [...pathReleases, optimisticRelease]
	}, [pathReleases, optimisticRelease])

	// Actions
	const handleReleasePath = async () => {
		if (!myTopBidEvent) return
		setIsReleasing(true)
		try {
			const result = await nip60Actions.settleAuctionAsWinner({
				bidEventId: myTopBidEvent.id,
				releaseReason: 'settlement',
			})
			// Optimistic UI: append synthetic release so the descriptor transitions
			// immediately to 'Path release published' (ADR-0004 Decision 4).
			if (!optimisticReleaseRef.current) {
				const synthetic: ParsedPathReleaseEvent = {
					rawEvent: { id: 'optimistic', pubkey: currentUserPubkey!, kind: 1025, tags: [], content: '' },
					id: 'optimistic-' + myTopBidEvent.id,
					bidderPubkey: currentUserPubkey!,
					createdAt: Math.floor(Date.now() / 1000),
					bidEventId: myTopBidEvent.id,
					auctionCoordinate: auctionCoordinates,
					sellerPubkey: auction.sellerPubkey,
					derivationPath: '',
					childPubkey: '',
					releaseReason: 'settlement',
					auditorRefs: [],
					content: '',
				}
				optimisticReleaseRef.current = synthetic
				setOptimisticRelease(synthetic)
			}
			void result.pathReleaseEventId
			await queryClient.invalidateQueries({ queryKey: auctionKeys.pathReleases(auctionRootEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(auctionRootEventId) })
			toast.success('Path release published — seller can now redeem')
		} catch (err) {
			toast.error(`Failed to release path: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setIsReleasing(false)
		}
	}

	const handleSubmitSettlement = async (status: 'reserve_not_met' | undefined) => {
		try {
			await settlementMutation.mutateAsync({
				auctionEventId: auctionRootEventId,
				auctionCoordinates,
				status,
				winningBidEventId: status ? undefined : descriptor?.cta?.kind === 'release-path' ? myTopBidEvent?.id : undefined,
			} as AuctionSettlementFormData)
		} catch {
			// Toast handled in mutation hook
		}
	}

	const dispatchCta = (descriptor: SettlementDescriptor) => {
		const cta = descriptor.cta
		if (!cta) return () => {}
		switch (cta.kind as SettlementCtaKind) {
			case 'release-path':
				return () => void handleReleasePath()
			case 'submit-settlement':
				return () => void handleSubmitSettlement(undefined)
			case 'close-auction':
				return () => void handleSubmitSettlement('reserve_not_met')
			case 'view-order':
				return () => {
					if (cta.orderId) {
						navigate({ to: `/dashboard/orders/${cta.orderId}` })
					} else {
						toast.error('Issue with order id. Go to Dashboard to find the order.')
					}
				}
			case 'open-claim-dialog':
				return () => setIsClaimDialogOpen(true)
			case 'refresh-page':
				return () => window.location.reload()
			default:
				return () => {}
		}
	}

	// Loading state
	if (ended && !auction) {
		return (
			<Card className={cn('p-4', className)}>
				<div className="flex items-start gap-3">
					<div className="mt-0.5">
						<AlertTriangle className="w-5 h-5 text-yellow-400" />
					</div>
					<div className="flex-1">
						<h3 className="font-semibold text-foreground">Verifying…</h3>
						<p className="text-sm text-foreground/80 mt-1">Validating settlement data.</p>
					</div>
				</div>
			</Card>
		)
	}

	const claimOrderEvents = useMemo(() => claimOrders, [claimOrders])

	const nut7States = useNut7Polling(bids, auction.mints)

	const descriptorInput = useMemo<GetSettlementDescriptorInput>(
		() => ({
			auction,
			bids,
			verdicts,
			nut7States,
			settlements,
			pathReleases: pathReleasesForDescriptor,
			claimOrders: claimOrderEvents,
			currentUserPubkey: currentUserPubkey || undefined,
			myTopBidEvent,
			hasBidderRecord: !!myBidderRecord,
			hasPlacedBid,
			now,
		}),
		[
			auction,
			bids,
			verdicts,
			nut7States,
			settlements,
			pathReleasesForDescriptor,
			claimOrderEvents,
			currentUserPubkey,
			myTopBidEvent,
			myBidderRecord,
			hasPlacedBid,
			now,
		],
	)

	const [descriptor, setDescriptor] = useState<SettlementDescriptor | null>(null)
	useEffect(() => {
		let cancelled = false
		getSettlementDescriptor(descriptorInput)
			.then((d) => {
				if (!cancelled) setDescriptor(d)
			})
			.catch((err) => {
				console.error('getSettlementDescriptor failed:', err)
			})
		return () => {
			cancelled = true
		}
	}, [descriptorInput])

	if (!descriptor) return null

	const badgeText =
		descriptor.verifiedBadge === 'settlement'
			? 'Verified · Settlement confirmed'
			: descriptor.verifiedBadge === 'path-release'
				? 'Verified · Path release confirmed'
				: descriptor.verifiedBadge === 'verifying'
					? 'Verifying…'
					: null

	const ctaHandler = dispatchCta(descriptor)
	const ctaLabel = descriptor.cta?.label ?? ''
	const ctaDisabled = isReleasing || settlementMutation.isPending || (descriptor.cta?.kind === 'release-path' && !!optimisticRelease)

	return (
		<>
			<Card className={cn('p-4', TONE_CLASSES[descriptor.tone], className)}>
				<div className="flex items-start gap-3">
					<div className="mt-0.5">{ICON_REGISTRY[descriptor.icon]}</div>
					<div className="flex-1">
						<h3 className="font-semibold text-foreground">{descriptor.title}</h3>
						<p className="text-sm text-foreground/80 mt-1">{descriptor.message}</p>

						{badgeText && descriptor.verifiedBadge === 'verifying' && (
							<div className="flex items-center gap-1.5 mt-2 text-xs">
								<AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
								<span className="text-yellow-400">{badgeText}</span>
							</div>
						)}
						{badgeText && descriptor.verifiedBadge !== 'verifying' && (
							<div className="flex items-center gap-1.5 mt-2 text-xs">
								<BadgeCheck className="w-3.5 h-3.5 text-green-400" />
								<span className="text-green-400 font-medium">{badgeText}</span>
							</div>
						)}

						{descriptor.cta && (
							<Button onClick={ctaHandler} disabled={ctaDisabled} className="mt-3" size="sm">
								{descriptor.cta.kind === 'release-path' && isReleasing
									? 'Releasing…'
									: (descriptor.cta.kind === 'submit-settlement' || descriptor.cta.kind === 'close-auction') && settlementMutation.isPending
										? 'Publishing…'
										: ctaLabel}
							</Button>
						)}
					</div>
				</div>
			</Card>

			{descriptor.cta?.kind === 'open-claim-dialog' && descriptor.cta.settlementEventId && (
				<AuctionClaimDialog
					open={isClaimDialogOpen}
					onOpenChange={setIsClaimDialogOpen}
					auctionEventId={auctionRootEventId}
					auctionCoordinates={auctionCoordinates}
					settlementEventId={descriptor.cta.settlementEventId}
					sellerPubkey={auction.sellerPubkey}
					finalAmount={descriptor.cta.finalAmount ?? 0}
				/>
			)}
		</>
	)
}
