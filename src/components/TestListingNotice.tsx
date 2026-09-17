import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTestLabelForCoordinate } from '@/queries/testLabels'
import { Link } from '@tanstack/react-router'
import { EyeOff } from 'lucide-react'
import { npubEncode } from 'nostr-tools/nip19'
import { useState, type MouseEvent } from 'react'

/** Fallback contact when the labeler's pubkey is not known (or not encodable). */
const TEAM_FALLBACK = 'the Plebeian team'

/**
 * Shorten an npub for display: `npub1abcdefgh…wxyz12`.
 * Returns null when the pubkey cannot be encoded so callers can fall back to
 * the Plebeian team rather than render a broken identifier.
 */
const shortenNpub = (pubkey: string): string | null => {
	try {
		const npub = npubEncode(pubkey)
		return `${npub.slice(0, 14)}…${npub.slice(-6)}`
	} catch {
		return null
	}
}

export interface TestListingNoticeProps {
	/**
	 * Item coordinate ("kind:pubkey:identifier"), or '' when the item has no
	 * coordinate yet. Computed by the caller via `getItemTestLabelCoordinate`
	 * or `getProductCoordinates`.
	 */
	coordinate: string
	/** Noun used in copy ('Product' | 'Auction') */
	itemLabel?: string
	/**
	 * 'badge' — full pill with label text, used on detail pages where there is
	 * room. 'icon' — compact corner marker for cards in a grid, where clicking
	 * must not navigate.
	 */
	variant?: 'badge' | 'icon'
	className?: string
}

/**
 * ADR-0009 — user-facing "this is a test listing" indicator.
 *
 * A test label hides an item from browsing and discovery surfaces only. The
 * item stays reachable by direct link, on the seller's profile, and in the
 * owner's dashboard — so a visitor who arrives through one of those routes
 * sees a listing that is missing from the feed with no explanation. This
 * notice supplies that explanation and an appeal path.
 *
 * Renders nothing unless the coordinate carries an active test label, so it is
 * safe to mount unconditionally on any item surface.
 *
 * The contact is resolved from the labeler's pubkey (an editor or admin), which
 * the label store tracks per coordinate; if it is unavailable the copy falls
 * back to the Plebeian team.
 */
export function TestListingNotice({ coordinate, itemLabel = 'Product', variant = 'badge', className }: TestListingNoticeProps) {
	const [isOpen, setIsOpen] = useState(false)
	const { isLabeled, labelerPubkey } = useTestLabelForCoordinate(coordinate || undefined)

	if (!isLabeled) return null

	const itemNoun = itemLabel.toLowerCase()
	const shortNpub = labelerPubkey ? shortenNpub(labelerPubkey) : null

	// Card clicks navigate to the product, so opening the explainer must not
	// bubble up to the surrounding <Link>.
	const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		setIsOpen(true)
	}

	return (
		<>
			{variant === 'icon' ? (
				<button
					type="button"
					data-testid="test-listing-notice-icon"
					aria-label={`This ${itemNoun} is marked as a test listing — see why`}
					title="Marked as a test listing"
					onClick={handleOpen}
					className={`flex justify-center items-center bg-amber-500 hover:bg-amber-600 shadow rounded-full w-6 h-6 text-white transition-colors ${className ?? ''}`}
				>
					<EyeOff className="w-3.5 h-3.5" />
				</button>
			) : (
				<button
					type="button"
					data-testid="test-listing-notice"
					aria-label={`This ${itemNoun} is marked as a test listing — see why`}
					onClick={handleOpen}
					// `w-fit` keeps the pill at its intrinsic width. Without it a flex
					// column parent (the product hero) stretches it to the full column
					// width because align-items defaults to stretch.
					className={`inline-flex justify-center items-center gap-1.5 w-fit bg-amber-100 hover:bg-amber-200 px-2.5 py-1 border border-amber-300 rounded-full font-medium text-amber-900 text-xs transition-colors ${className ?? ''}`}
				>
					<EyeOff className="w-3.5 h-3.5" />
					<span>Test listing</span>
				</button>
			)}

			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogContent className="max-w-md" data-testid="test-listing-notice-dialog">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<EyeOff className="w-5 h-5 text-amber-500" />
							This {itemNoun} is marked as a test listing
						</DialogTitle>
						<DialogDescription>
							A marketplace curator (an editor or admin) marked this listing as a test. Test listings are hidden from browsing, search and
							collections — the home feed, browse listings, search results and collection pages — but they stay reachable by direct link, on
							the seller's profile, and in the owner's dashboard.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-2 text-sm">
						<p className="font-medium">Think this is a mistake?</p>
						<p className="text-muted-foreground">
							Contact the curator who applied the label, or the Plebeian team, and ask for the label to be removed. Only the curator who
							applied a label can delete it.
						</p>
						<p data-testid="test-listing-notice-contact" className="text-muted-foreground">
							{shortNpub && labelerPubkey ? (
								<>
									Curator:{' '}
									<Link
										to="/profile/$profileId"
										params={{ profileId: labelerPubkey }}
										title={labelerPubkey}
										className="font-medium text-primary underline"
									>
										{shortNpub}
									</Link>
								</>
							) : (
								<>Curator: {TEAM_FALLBACK}</>
							)}
						</p>
					</div>

					<DialogFooter>
						<Button variant="outline" data-testid="test-listing-notice-close" onClick={() => setIsOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
