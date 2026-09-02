import { Button } from '@/components/ui/button'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { publishTestLabel, publishTestLabelDeletion } from '@/lib/actions/testLabelActions'
import { TEST_LABEL_PRODUCT_KIND } from '@/lib/constants/testLabels'
import { getATagFromCoords } from '@/lib/utils/coords'
import { useAmIAdmin } from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { invalidateTestLabelCaches, useTestLabelForCoordinate } from '@/queries/testLabels'
import { useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Loader2 } from 'lucide-react'
import { npubEncode } from 'nostr-tools/nip19'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

interface TestLabelButtonProps {
	/** Item event kind: 30402 (product) or 30408 (auction) */
	kind: number
	/** Author pubkey of the item */
	pubkey: string
	/** Item d-tag identifier */
	dTag: string
	/** Noun used in button labels and copy ('Product' | 'Auction') */
	itemLabel?: string
	/** Optional wrapper className */
	className?: string
}

const CONTACT_REF_FALLBACK = 'the moderation team'

/**
 * Dashboard action for authorized labelers (ADR-0009): mark / unmark an item
 * as a "test" listing via NIP-32 label events (kind 1985) and NIP-09
 * deletion events (kind 5).
 *
 * - Visible only to authorized labelers (the admin set).
 * - "Mark as Test" publishes a kind-1985 label event with a pre-filled,
 *   editable contact reference in `.content`.
 * - "Unmark as Test" (visible only when an active label exists) publishes a
 *   NIP-09 deletion event referencing the label event id, after a confirm
 *   dialog.
 * - Both update the store optimistically, then reconcile with the relay.
 */
export function TestLabelButton({ kind, pubkey, dTag, itemLabel = 'Product', className }: TestLabelButtonProps) {
	const queryClient = useQueryClient()
	const { data: config } = useConfigQuery()
	const { amIAdmin, currentUserPubkey } = useAmIAdmin(config?.appPublicKey)

	const [isMarking, setIsMarking] = useState(false)
	const [isUnmarking, setIsUnmarking] = useState(false)
	const [labelContent, setLabelContent] = useState('')

	const isProduct = kind === TEST_LABEL_PRODUCT_KIND
	const kindSlug = isProduct ? 'product' : 'auction'

	const coordinate = pubkey && dTag ? getATagFromCoords({ kind, pubkey, identifier: dTag }) : ''
	const { isLabeled, labelEventId } = useTestLabelForCoordinate(coordinate || undefined)

	const contactRef = useMemo(() => {
		if (!currentUserPubkey) return CONTACT_REF_FALLBACK
		try {
			return npubEncode(currentUserPubkey)
		} catch {
			return CONTACT_REF_FALLBACK
		}
	}, [currentUserPubkey])

	// Non-authorized users never see these controls
	if (!amIAdmin || !currentUserPubkey || !coordinate) return null

	const itemNoun = itemLabel.toLowerCase()
	const defaultLabelContent = `Marked as test listing. If this is a real ${itemNoun}, contact ${contactRef} to request removal.`
	const resolvedLabelContent = labelContent || defaultLabelContent

	const handleMark = async () => {
		setIsMarking(true)
		try {
			await publishTestLabel({ coordinate, contactRef, content: resolvedLabelContent })
			await invalidateTestLabelCaches(queryClient, coordinate)
			toast.success(`${itemLabel} marked as test — excluded from feeds.`)
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
			await invalidateTestLabelCaches(queryClient, coordinate)
			toast.success(`Test label removed — ${itemNoun} is visible again.`)
		} catch (error) {
			console.error('Failed to publish test label deletion:', error)
			toast.error(`Failed to unmark as test: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsUnmarking(false)
		}
	}

	if (isLabeled) {
		return (
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						disabled={isUnmarking}
						className={className}
						data-testid={`unmark-test-label-${kindSlug}-button`}
					>
						{isUnmarking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
						Unmark as Test {itemLabel}
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove the test label?</AlertDialogTitle>
						<AlertDialogDescription>
							This will publish a deletion event for the test label. The {itemNoun} will reappear in feeds and detail views.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleUnmark}>Unmark as Test</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		)
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button variant="outline" size="sm" disabled={isMarking} className={className} data-testid={`mark-test-label-${kindSlug}-button`}>
					{isMarking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
					Mark as Test {itemLabel}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Mark this {itemNoun} as a test listing?</AlertDialogTitle>
					<AlertDialogDescription>
						A NIP-32 label event will be published. The {itemNoun} will be excluded from feeds and detail views. The content below is sent
						with the label — edit it if needed so the author knows how to appeal.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<Textarea
					data-testid={`test-label-content-${kindSlug}`}
					value={resolvedLabelContent}
					onChange={(event) => setLabelContent(event.target.value)}
					rows={3}
					className="text-sm"
				/>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={handleMark}>Mark as Test</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
