import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { inspectAuctionAdmission, type AuctionAdmission } from '@/lib/schemas/auction/auctionAdmission'
import { AlertTriangle, Ban } from 'lucide-react'
import { useState } from 'react'

export interface InvalidAuctionNoticeProps {
	/** The event being displayed. Nothing renders when it passes admission. */
	event: NostrEventLike | null | undefined
	/** Noun used in copy ('Auction'). */
	itemLabel?: string
	className?: string
}

/**
 * Spec-validity indicator for a kind-30408 event — the counterpart of
 * `TestListingNotice`, for a different reason.
 *
 * A malformed auction event is excluded from the feed and the browse surfaces
 * (see `filterAdmissibleAuctionEvents`) but stays reachable by direct link, so a
 * visitor who arrives through a shared URL sees an auction that is missing from
 * every list, with no explanation. This notice supplies the explanation *and*
 * the specific reason — the offending tags — because "invalid" alone is not
 * actionable for the seller who has to republish the event.
 *
 * It reads the same single source of truth the gate reads
 * (`inspectAuctionAdmission` → `parseAuctionEvent`), so the badge can never
 * disagree with the reason the auction is absent from the feed.
 *
 * Renders nothing for an admissible event, so it is safe to mount
 * unconditionally on any auction surface.
 */
export function InvalidAuctionNotice({ event, itemLabel = 'Auction', className }: InvalidAuctionNoticeProps) {
	const [isOpen, setIsOpen] = useState(false)

	if (!event) return null

	const admission = inspectAuctionAdmission(event)
	if (admission.admissible) return null

	const itemNoun = itemLabel.toLowerCase()

	return (
		<>
			<button
				type="button"
				data-testid="invalid-auction-notice"
				aria-label={`This ${itemNoun} event is malformed — see why`}
				title="Malformed auction event"
				onClick={() => setIsOpen(true)}
				// `w-fit` keeps the pill at its intrinsic width (see
				// TestListingNotice: a flex column parent would stretch it).
				className={`inline-flex justify-center items-center gap-1.5 w-fit bg-red-100 hover:bg-red-200 px-2.5 py-1 border border-red-300 rounded-full font-medium text-red-900 text-xs transition-colors ${className ?? ''}`}
			>
				<AlertTriangle className="w-3.5 h-3.5" />
				<span>Invalid event</span>
			</button>

			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogContent className="max-w-md" data-testid="invalid-auction-notice-dialog">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="w-5 h-5 text-red-500" />
							This {itemNoun} event is malformed
						</DialogTitle>
						<DialogDescription>
							This event exists on the relay and stays reachable by this link, but it is not a well-formed auction (AUCTIONS.md §4.1), so it
							is left out of the auction feed and the browse pages — and it cannot be bid on.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-2 text-sm">
						<p className="font-medium">Why:</p>
						<ul data-testid="invalid-auction-notice-reasons" className="space-y-1 text-muted-foreground">
							{admission.issues.map((issue, index) => (
								<li key={`${issue.code}-${issue.tag ?? index}`} className="flex gap-2">
									<span aria-hidden>•</span>
									<span data-testid="invalid-auction-notice-reason">{issue.message}</span>
								</li>
							))}
						</ul>
						<p className="text-muted-foreground">
							A corrected event has to be published by the seller. Kind 30408 is addressable, so the newest version replaces this one and
							the auction returns to the feed.
						</p>
					</div>

					<DialogFooter>
						<Button variant="outline" data-testid="invalid-auction-notice-close" onClick={() => setIsOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}

export interface InvalidAuctionBidBlockProps {
	admission: AuctionAdmission
	/** Noun used in copy ('auction'). */
	itemLabel?: string
	/** Card mode: a compact pill instead of the full panel. */
	compact?: boolean
	className?: string
}

/**
 * The bid-side half of spec validity: a malformed auction event is not biddable.
 *
 * Why this exists — the ruling of 2026-09-19: "don't allow bidding on invalid
 * auctions, just for cleanliness / avoiding problematic scenarios". The detail
 * page resolves a malformed event by design (ADR-0009's reachability rule), so
 * without this block the bid panel renders against an event the parser refuses:
 * the bidder's eCash is locked to a seller-derived P2PK key at the mint, and the
 * bid is then rejected downstream by the validators — the funds stay locked
 * until the locktime. Nothing in that flow is recoverable by the bidder, and
 * every check the bid path makes (window, floor, increment) is derived from the
 * same tags the parser could not read, so the numbers the bidder sees are
 * guesses.
 *
 * It takes the `AuctionAdmission` its caller already computed rather than
 * inspecting the event again, so the panel and the notice can never disagree
 * about whether the event is admissible. Rendered by `AuctionBidder`, the only
 * component that renders an auction bid control, so every surface that offers a
 * bid inherits the block.
 */
export function InvalidAuctionBidBlock({ admission, itemLabel = 'auction', compact = false, className }: InvalidAuctionBidBlockProps) {
	if (admission.admissible) return null

	if (compact) {
		return (
			<div
				data-testid="invalid-auction-bid-blocked"
				title="This auction event is malformed, so bidding is disabled"
				className={`inline-flex w-fit items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-900 ${className ?? ''}`}
			>
				<Ban className="h-3.5 w-3.5" />
				<span>Bidding disabled</span>
			</div>
		)
	}

	return (
		<div data-testid="invalid-auction-bid-blocked" className={`w-full rounded-lg border border-red-300 bg-red-50 p-4 ${className ?? ''}`}>
			<div className="flex items-center gap-2 text-sm font-semibold text-red-900">
				<Ban className="h-4 w-4" />
				<h3>Bidding is disabled on this {itemLabel}</h3>
			</div>
			<p className="mt-2 text-sm text-red-900/90">
				This event is not a well-formed {itemLabel} (AUCTIONS.md §4.1), so the app will not accept a bid against it. A bid would lock your
				eCash to an
				{` ${itemLabel} `}the validators refuse — and leave it locked until the locktime.
			</p>
			<ul data-testid="invalid-auction-bid-blocked-reasons" className="mt-2 space-y-1 text-xs text-red-900/80">
				{admission.issues.map((issue, index) => (
					<li key={`${issue.code}-${issue.tag ?? index}`} className="flex gap-2">
						<span aria-hidden>•</span>
						<span>{issue.message}</span>
					</li>
				))}
			</ul>
			<p className="mt-3 text-xs text-red-900/80">
				The seller has to publish a corrected event. Kind 30408 is addressable, so the newest version replaces this one and bidding reopens
				with it.
			</p>
		</div>
	)
}
