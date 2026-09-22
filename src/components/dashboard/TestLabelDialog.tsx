import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { publishTestLabel, publishTestLabelDeletion } from '@/lib/actions/testLabelActions'
import { TEST_LABEL_PRODUCT_KIND } from '@/lib/constants/testLabels'
import { getATagFromCoords } from '@/lib/utils/coords'
import { invalidateTestLabelCaches, useTestLabelForCoordinate } from '@/queries/testLabels'
import { useQueryClient } from '@tanstack/react-query'
import { npubEncode } from 'nostr-tools/nip19'
import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

export interface TestLabelDialogProps {
	/** Item event kind: 30402 (product) or 30408 (auction) */
	kind: number
	/** Author pubkey of the item (not the labeler) */
	pubkey: string
	/** Item d-tag identifier */
	dTag: string
	/** Noun used in copy ('Product' | 'Auction') */
	itemLabel?: string
	/** Controlled open state */
	open: boolean
	onOpenChange: (open: boolean) => void
	/**
	 * 'mark' publishes a kind-1985 label; 'unmark' publishes a NIP-09
	 * deletion for the active label. Kept explicit (rather than derived) so a
	 * caller acting on a stale label can still reach the deletion confirm.
	 */
	mode: 'mark' | 'unmark'
	/** Called after a successful publish, so callers can reset menu state. */
	onCompleted?: () => void
	/** Acting labeler's pubkey, used to build the appeal contact reference. */
	contactPubkey?: string
}

const CONTACT_REF_FALLBACK = 'the Plebeian team'

/**
 * Shared ADR-0009 test-label dialog for authorized labelers.
 *
 * Extracted from `TestLabelButton` so the same mark/unmark flow can be driven
 * from more than one surface — currently the owner dashboard edit page and the
 * public product page's `EntityActionsMenu` (curation of other sellers'
 * listings, retaining the editable contact reference).
 *
 * Authorization is deliberately NOT checked here: callers must gate on
 * `useEntityPermissions().canManageTestLabel` (the authorized labeler set is
 * editors UNION admins, plus the app owner) before rendering.
 * `isValidAuthorizedTestLabel` only honours labels authored by that set, so
 * rendering this for anyone else would publish a label the query layer
 * silently ignores.
 *
 * Copy note: a test label gates **browsing and discovery only** (ADR-0009 —
 * home feed, browse, search, collections, auction feed). The item stays
 * reachable by direct link, on the seller's profile, and in the owner's
 * dashboard. The dialog text must state that exact effect — an earlier version
 * claimed the item was removed from "detail views", which is wrong and would
 * mislead a labeler about what they are doing.
 */
export function TestLabelDialog({
	kind,
	pubkey,
	dTag,
	itemLabel = 'Product',
	open,
	onOpenChange,
	mode,
	onCompleted,
	contactPubkey,
}: TestLabelDialogProps) {
	const queryClient = useQueryClient()
	const contentFieldId = useId()

	const [isMarking, setIsMarking] = useState(false)
	const [isUnmarking, setIsUnmarking] = useState(false)
	const [labelContent, setLabelContent] = useState('')

	const isProduct = kind === TEST_LABEL_PRODUCT_KIND
	const kindSlug = isProduct ? 'product' : 'auction'

	const coordinate = pubkey && dTag ? getATagFromCoords({ kind, pubkey, identifier: dTag }) : ''
	const { labelEventId } = useTestLabelForCoordinate(coordinate || undefined)

	// Contact reference is resolved from the acting labeler when known.
	const contactRef = useMemo(() => {
		if (!contactPubkey) return CONTACT_REF_FALLBACK
		try {
			return npubEncode(contactPubkey)
		} catch {
			return CONTACT_REF_FALLBACK
		}
	}, [contactPubkey])

	const itemNoun = itemLabel.toLowerCase()
	// The label content is the appeal message published to the relay, and the
	// only part of this flow the seller (or any other client) reads. It states
	// the effect too, because a reader who arrives via a direct link sees a
	// listing that is missing from the feed with no other explanation.
	const appealContact = contactRef === CONTACT_REF_FALLBACK ? CONTACT_REF_FALLBACK : `${contactRef} or ${CONTACT_REF_FALLBACK}`
	const defaultLabelContent = `Marked as test listing. This ${itemNoun} is hidden from browsing and search but stays reachable by direct link. If this is a real ${itemNoun}, contact ${appealContact} to request removal.`
	const resolvedLabelContent = labelContent || defaultLabelContent

	const handleMark = async () => {
		setIsMarking(true)
		try {
			await publishTestLabel({ coordinate, contactRef, content: resolvedLabelContent })
			await invalidateTestLabelCaches(queryClient)
			toast.success(`${itemLabel} marked as test — hidden from browse and search.`)
			onOpenChange(false)
			onCompleted?.()
		} catch (error) {
			console.error('Failed to publish test label:', error)
			toast.error(`Failed to mark as test: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsMarking(false)
		}
	}

	const handleUnmark = async () => {
		setIsUnmarking(true)
		try {
			await publishTestLabelDeletion({ coordinate, labelEventId })
			await invalidateTestLabelCaches(queryClient)
			toast.success(`Test label removed — ${itemNoun} is back in browse and search.`)
			onOpenChange(false)
			onCompleted?.()
		} catch (error) {
			console.error('Failed to publish test label deletion:', error)
			toast.error(`Failed to unmark as test: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsUnmarking(false)
		}
	}

	if (mode === 'unmark') {
		return (
			<AlertDialog open={open} onOpenChange={onOpenChange}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove the test label?</AlertDialogTitle>
						<AlertDialogDescription data-testid={`test-label-unmark-description-${kindSlug}`}>
							A NIP-09 deletion event is published for the label you applied. This {itemNoun} returns to browsing, search and collections
							immediately — it was never hidden from direct links, seller profiles, or the owner's dashboard.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleUnmark} disabled={isUnmarking}>
							Unmark as Test
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		)
	}

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Mark this {itemNoun} as a test listing?</AlertDialogTitle>
					<AlertDialogDescription data-testid={`test-label-mark-description-${kindSlug}`}>
						A NIP-32 label is published under your key as an authorized labeler. This {itemNoun} is hidden from browsing, search and
						collections — the home feed, browse listings, search results and collection pages — but it stays reachable by direct link, on
						the seller's profile, and in the owner's dashboard. The message below is published with the label, so the seller sees it was
						curated and knows how to appeal.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-1.5">
					<Label htmlFor={contentFieldId} className="text-sm font-medium">
						Message published with the label
					</Label>
					<Textarea
						id={contentFieldId}
						data-testid={`test-label-content-${kindSlug}`}
						value={resolvedLabelContent}
						onChange={(event) => setLabelContent(event.target.value)}
						rows={4}
						className="text-sm"
					/>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={handleMark} disabled={isMarking}>
						Mark as Test
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
