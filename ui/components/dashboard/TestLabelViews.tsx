import { useId } from 'react'
import { FlaskConical } from 'lucide-react'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../../primitives/alert-dialog'
import { Button } from '../../primitives/button'
import { Label } from '../../primitives/label'
import { Textarea } from '../../primitives/textarea'

export type TestLabelKindSlug = 'product' | 'auction'
export type TestLabelDialogMode = 'mark' | 'unmark'

export interface TestLabelButtonViewProps {
	isLabeled: boolean
	/** Noun used in copy, e.g. 'Product' or 'Auction'. */
	itemLabel: string
	kindSlug: TestLabelKindSlug
	className?: string
	onPress: (mode: TestLabelDialogMode) => void
}

export function TestLabelButtonView({ isLabeled, itemLabel, kindSlug, className, onPress }: TestLabelButtonViewProps) {
	const mode: TestLabelDialogMode = isLabeled ? 'unmark' : 'mark'
	return (
		<Button
			variant="outline"
			size="sm"
			className={className}
			data-testid={`${mode}-test-label-${kindSlug}-button`}
			onClick={() => onPress(mode)}
		>
			<FlaskConical className="h-3.5 w-3.5" />
			{isLabeled ? 'Unmark' : 'Mark'} as Test {itemLabel}
		</Button>
	)
}

export interface TestLabelDialogViewProps {
	mode: TestLabelDialogMode
	open: boolean
	onOpenChange: (open: boolean) => void
	itemLabel: string
	kindSlug: TestLabelKindSlug
	/** Appeal message published with the label (mark mode only). */
	content: string
	onContentChange: (content: string) => void
	isBusy: boolean
	onConfirm: () => void
}

/**
 * A test label gates browsing and discovery only (ADR-0009); the copy must state
 * that the item stays reachable by direct link, seller profile and dashboard.
 */
export function TestLabelDialogView({
	mode,
	open,
	onOpenChange,
	itemLabel,
	kindSlug,
	content,
	onContentChange,
	isBusy,
	onConfirm,
}: TestLabelDialogViewProps) {
	const contentFieldId = useId()
	const itemNoun = itemLabel.toLowerCase()

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
						<AlertDialogAction onClick={onConfirm} disabled={isBusy}>
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
						value={content}
						onChange={(event) => onContentChange(event.target.value)}
						rows={4}
						className="text-sm"
					/>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} disabled={isBusy}>
						Mark as Test
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
