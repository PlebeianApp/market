// src/components/auction/LatestBidsContainer.tsx
import { getBidAmount, getBidMint, useStreamingAuctionBids } from '@/queries/auctions'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { cn } from '@/lib/utils'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { formatSats, getMintHostname } from '@/lib/wallet'
import { Badge } from '@/components/ui/badge'
import type { ReactNode } from 'react'
import { UserCard } from '@/components/UserCard'
import { Check, Landmark } from 'lucide-react'
import type { ValidatedBidSet } from '@/lib/auction/bidValidation'
import {
	getValidatedTopAmount,
	getValidatedTopBidderPubkey,
	getValidatedBidderState,
	getBidClassification,
} from '@/lib/auction/validatedBidView'

function TechnicalDataRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
			<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
			<div className="mt-1 break-all text-sm font-medium text-zinc-900">{value}</div>
		</div>
	)
}

interface Props {
	auctionRootEventId: string
	auctionCoordinates: string
	currentUserPubkey?: string
	isEnded?: boolean
	className?: string
	/**
	 * Optional validated bid set. When present, the highest-bid badge,
	 * outbid notice, and bid-list classifications are derived from the
	 * validated set's canonicalWinner and classification instead of raw
	 * bid chain computation.
	 */
	validatedBidSet?: ValidatedBidSet | null
}

type BidTone = 'blue' | 'orange' | 'green' | 'pink' | 'white'

const toneContainerClassName: Record<BidTone, string> = {
	blue: 'border-sky-200 bg-sky-50',
	orange: 'border-amber-300 bg-amber-100',
	green: 'border-emerald-300 bg-emerald-100',
	pink: 'border-pink-400 bg-pink-50',
	white: 'border-zinc-200 bg-zinc-50/70',
}

const toneLabelClassName: Record<BidTone, string> = {
	blue: 'text-sky-700',
	orange: 'text-amber-800',
	green: 'text-emerald-800',
	pink: 'text-pink-600',
	white: 'text-zinc-500',
}

function formatBidRecordedAt(bidEvent: NostrEventLike): string {
	return bidEvent.created_at ? new Date(bidEvent.created_at * 1000).toLocaleString() : 'Unknown time'
}

function BidMintRow({ mint }: { mint: string }) {
	return (
		<div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
			<div className="relative flex h-6 cursor-default items-center px-2">
				<Landmark className="size-4 text-primary" />
				<span className="absolute -bottom-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-pink-500 text-[9px] font-bold leading-none text-white">
					<Check className="h-2 w-2 text-white stroke-[3]" />
				</span>
			</div>
			<p>Mint: {mint ? getMintHostname(mint) : 'N/A'}</p>
		</div>
	)
}

function BidEventDetails({ bidEvent }: { bidEvent: NostrEventLike }) {
	const locktime = bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1]
	const bidKeyScheme = bidEvent.tags.find((tag) => tag[0] === 'key_scheme')?.[1] || 'hd_p2pk'

	return (
		<Accordion type="single" collapsible className="rounded-xl border border-zinc-200 bg-white px-4">
			<AccordionItem value={`bid-${bidEvent.id}`} className="border-none">
				<AccordionTrigger className="py-4 text-sm font-semibold text-zinc-900 hover:no-underline">Bid event details</AccordionTrigger>
				<AccordionContent className="space-y-3 pb-4">
					<TechnicalDataRow label="Bidder pubkey" value={bidEvent.pubkey} />
					<TechnicalDataRow label="Mint" value={getBidMint(bidEvent) || 'N/A'} />
					<TechnicalDataRow label="Key scheme" value={bidKeyScheme} />
					<TechnicalDataRow label="Locktime" value={locktime ? new Date(parseInt(locktime, 10) * 1000).toLocaleString() : 'N/A'} />
					<TechnicalDataRow label="Bid event ID" value={bidEvent.id} />
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	)
}

export function AuctionBidsContainer({
	auctionRootEventId,
	auctionCoordinates,
	currentUserPubkey,
	isEnded,
	className,
	validatedBidSet,
}: Props) {
	const { bids } = useStreamingAuctionBids(auctionRootEventId, 500, auctionCoordinates)

	// Determine top bid — use the validated canonicalWinner when available,
	// otherwise fall back to raw bid sort (legacy behaviour).
	//
	// Both branches yield a raw nostr event shape: `bids` comes from
	// `useStreamingAuctionBids` (which returns `NostrEventLike[]`, not NDKEvent)
	// and `canonicalWinner.rawEvent` is `NostrEventLike` too. Keep the local
	// helpers on `NostrEventLike` rather than widening to NDKEvent — nothing
	// here uses NDK-only members.
	let topBid: NostrEventLike | null
	let topBidPubkey: string | null
	let topAmount: number

	if (validatedBidSet) {
		topBid = validatedBidSet.canonicalWinner?.rawEvent ?? null
		topBidPubkey = getValidatedTopBidderPubkey(validatedBidSet)
		topAmount = getValidatedTopAmount(validatedBidSet)
	} else {
		topBid = bids.reduce<NostrEventLike | null>((best, bid) => {
			if (!best) return bid

			const amountDiff = getBidAmount(bid) - getBidAmount(best)
			if (amountDiff > 0) return bid
			if (amountDiff < 0) return best

			const createdAtDiff = (bid.created_at ?? 0) - (best.created_at ?? 0)
			if (createdAtDiff < 0) return bid
			if (createdAtDiff > 0) return best

			return bid.id.localeCompare(best.id) < 0 ? bid : best
		}, null)
		topBidPubkey = topBid?.pubkey ?? null
		topAmount = topBid ? getBidAmount(topBid) : 0
	}

	const latestBids = [...bids]
		.filter((bid) => bid.id !== topBid?.id)
		.sort((a, b) => {
			const createdAtDiff = (b.created_at || 0) - (a.created_at || 0)
			if (createdAtDiff !== 0) return createdAtDiff
			return b.id.localeCompare(a.id)
		})

	const hasOwnBids = !!currentUserPubkey && bids.some((bid) => bid.pubkey === currentUserPubkey)
	const topBidIsOwn = !!topBid && topBidPubkey === currentUserPubkey
	const topBidTone: BidTone = topBidIsOwn ? 'green' : hasOwnBids ? 'orange' : 'blue'
	const myHighestBidAmount = hasOwnBids
		? bids.filter((bid) => bid.pubkey === currentUserPubkey).reduce((max, bid) => Math.max(max, getBidAmount(bid)), 0)
		: 0
	const showOutbidNotice = !topBidIsOwn && hasOwnBids && !isEnded

	return bids.length === 0 ? (
		<div className={cn('rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6 text-sm text-zinc-500', className)}>
			No bids yet. The latest bids will appear here once bidders lock funds.
		</div>
	) : (
		<div className="space-y-4">
			{topBid && (
				<div className={cn('flex flex-col gap-4 rounded-xl border-2 px-4 py-4 shadow-sm', toneContainerClassName[topBidTone])}>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className={cn('text-[11px] font-semibold uppercase tracking-[0.18em]', toneLabelClassName[topBidTone])}>
								Highest visible bid
							</p>
							<p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{formatSats(topAmount)} sats</p>
							<p className="mt-1 text-sm text-zinc-600">Recorded {formatBidRecordedAt(topBid)}</p>
						</div>
						<div className="flex flex-col items-end gap-2">
							<div className="flex items-center gap-2">
								{topBidIsOwn && <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Your Bid</Badge>}
								{!topBidIsOwn && hasOwnBids && (
									<Badge className="border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100">Outbid</Badge>
								)}
							</div>
						</div>
					</div>

					<UserCard pubkey={topBidPubkey ?? ''} size="md" />
					<BidMintRow mint={getBidMint(topBid)} />
					<BidEventDetails bidEvent={topBid} />
				</div>
			)}

			{showOutbidNotice && (
				<div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
					Your previous bid of {formatSats(myHighestBidAmount)} sats was outbid. Bid again to try win the auction.
				</div>
			)}

			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500">Latest bids</h3>
					<p className="text-xs text-zinc-500">
						{latestBids.length} more bid{latestBids.length === 1 ? '' : 's'}
					</p>
				</div>

				<div className={cn('max-h-[500px] space-y-3 overflow-y-auto pr-1', className)}>
					{latestBids.length === 0 ? (
						<div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">
							No other bids yet.
						</div>
					) : (
						latestBids.map((bidEvent) => {
							const isOwnBid = bidEvent.pubkey === currentUserPubkey
							const classification = validatedBidSet ? getBidClassification(validatedBidSet, bidEvent.id) : null
							const tone: BidTone = isOwnBid ? 'pink' : 'white'
							return (
								<div
									key={bidEvent.id}
									className={cn(
										'flex flex-col gap-3 rounded-xl border px-4 py-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
										toneContainerClassName[tone],
									)}
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="text-xl font-semibold tracking-tight text-zinc-950">{formatSats(getBidAmount(bidEvent))} sats</p>
											<p className="mt-1 text-sm text-zinc-500">Recorded {formatBidRecordedAt(bidEvent)}</p>
										</div>
										<div className="flex items-center gap-2">
											{classification && classification !== 'valid' && (
												<Badge
													className={cn(
														'border-zinc-300',
														classification === 'invalid'
															? 'bg-red-100 text-red-700 hover:bg-red-100'
															: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
													)}
												>
													{classification === 'invalid' ? 'Rejected' : 'Pending'}
												</Badge>
											)}
											{isOwnBid && <Badge className="border-pink-400 bg-pink-100 text-pink-700 hover:bg-pink-100">Your Bid</Badge>}
										</div>
									</div>

									<UserCard pubkey={bidEvent.pubkey} size="sm" />
									<BidMintRow mint={getBidMint(bidEvent)} />
									<BidEventDetails bidEvent={bidEvent} />
								</div>
							)
						})
					)}
				</div>
			</div>
		</div>
	)
}
