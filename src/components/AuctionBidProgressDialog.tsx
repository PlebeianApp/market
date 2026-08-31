/**
 * Bid submission progress dialog — shows a visual stepper tracking the
 * bid from e-cash minting through relay publication to third-party
 * validator (kind-30440) confirmation.
 *
 * Rendered by AuctionBidder when the funding lifecycle enters the
 * publish/validator phase. The dialog stays open until the user
 * dismisses it or a terminal outcome (validator confirmed, bid
 * rejected, or publish failure) is reached.
 */

import { useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Check, AlertCircle } from 'lucide-react'
import { useAuctionVerdicts } from '@/queries/auctions'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import type { ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { computeVerdictQuorum } from '@/lib/auction/verdictQuorum'
import type { AuctionBidFundingLifecycleState } from '@/hooks/useAuctionBidFunding'
import { AvatarUser } from '@/components/AvatarUser'
import { cn } from '@/lib/utils'

interface AuctionBidProgressDialogProps {
	open: boolean
	onClose: () => void
	lifecycleState: AuctionBidFundingLifecycleState
	auctionRootEventId: string
	auctionCoordinates: string
	validatorPubkeys: string[]
	/**
	 * Id of the exact published kind-1023 bid event. When provided, only
	 * verdicts bound to this bid count (a rebid's verdict cannot leak into an
	 * earlier leg and vice-versa).
	 */
	bidEventId?: string
	/** Number of distinct auditor verdicts required to confirm/reject the bid. */
	auditorQuorum?: number
	onRetryPublish?: () => void
}

type StageStatus = 'done' | 'active' | 'pending' | 'error'

interface StageProps {
	label: string
	status: StageStatus
	description?: string
}

function ProgressStage({ label, status, description }: StageProps) {
	const icon = {
		done: <Check className="w-5 h-5 text-green-500" />,
		active: <Loader2 className="w-5 h-5 animate-spin text-blue-500" />,
		pending: <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />,
		error: <AlertCircle className="w-5 h-5 text-destructive" />,
	}[status]

	return (
		<div className="flex items-start gap-3 py-2.5">
			<div className="mt-0.5 shrink-0">{icon}</div>
			<div className="flex flex-col gap-0.5 min-w-0">
				<span
					className={cn(
						'text-sm font-medium',
						status === 'pending' && 'text-muted-foreground',
						status === 'done' && 'text-foreground',
						status === 'active' && 'text-foreground',
						status === 'error' && 'text-destructive',
					)}
				>
					{label}
				</span>
				{description && <span className="text-xs text-muted-foreground">{description}</span>}
			</div>
		</div>
	)
}

export function AuctionBidProgressDialog({
	open,
	onClose,
	lifecycleState,
	auctionRootEventId,
	auctionCoordinates,
	validatorPubkeys,
	bidEventId,
	auditorQuorum,
	onRetryPublish,
}: AuctionBidProgressDialogProps) {
	// Fetch only verdicts from the auction's configured auditors (when the
	// auction lists any) — forged verdicts from arbitrary pubkeys are never
	// even requested, let alone counted.
	const verdictsQuery = useAuctionVerdicts(auctionRootEventId, 500, auctionCoordinates, validatorPubkeys)

	const parsedVerdicts = useMemo(
		() =>
			(verdictsQuery.data ?? [])
				.map(parseValidatorVerdictEvent)
				.filter((r): r is { ok: true; value: ParsedValidatorVerdictEvent } => r.ok)
				.map((r) => r.value),
		[verdictsQuery.data],
	)

	// Quorum gate: bind to the exact published bid event, accept only the
	// auction's configured auditors, dedupe per validator, and require
	// `auditorQuorum` distinct confirms/condemns before a terminal state.
	const { representativeVerdict, hasPositiveVerdict, hasNegativeVerdict, hasNeutralVerdict } = computeVerdictQuorum(
		parsedVerdicts,
		bidEventId,
		validatorPubkeys,
		auditorQuorum,
	)

	const isPublishAttempted = lifecycleState === 'bid_publish_attempted'
	const isBidPublished = lifecycleState === 'bid_published'
	const isPublishFailed = lifecycleState === 'mint_succeeded_bid_publish_failed_reclaimable'

	const isAwaitingValidator = isBidPublished && !hasPositiveVerdict && !hasNegativeVerdict

	const isTerminal = hasPositiveVerdict || hasNegativeVerdict || isPublishFailed

	// Stage statuses
	const fundingStage: StageStatus = 'done' // Funding is always complete by the time the dialog opens
	const publishStage: StageStatus = isPublishFailed ? 'error' : isBidPublished ? 'done' : isPublishAttempted ? 'active' : 'pending'
	const validatorStage: StageStatus = hasPositiveVerdict
		? 'done'
		: hasNegativeVerdict
			? 'error'
			: isAwaitingValidator && validatorPubkeys.length > 0
				? 'active'
				: 'pending'

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{hasPositiveVerdict ? (
							<Check className="w-5 h-5 text-green-500" />
						) : isPublishFailed || hasNegativeVerdict ? (
							<AlertCircle className="w-5 h-5 text-destructive" />
						) : (
							<Loader2 className="w-5 h-5 animate-spin text-blue-500" />
						)}
						{hasPositiveVerdict
							? 'Bid Confirmed'
							: isPublishFailed
								? 'Bid Publish Failed'
								: hasNegativeVerdict
									? 'Bid Rejected'
									: 'Placing Your Bid'}
					</DialogTitle>
					<DialogDescription>
						{hasPositiveVerdict
							? 'Your bid has been published and validated by the auction validators.'
							: isPublishFailed
								? 'Your e-cash was minted but the bid could not be published to relays. You can retry or reclaim your funds.'
								: hasNegativeVerdict
									? `A validator has flagged this bid: ${representativeVerdict?.claim ?? 'rejected'}`
									: 'Tracking your bid through confirmation stages.'}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-1 py-2">
					<ProgressStage label="Funding confirmed" status={fundingStage} description="Lightning payment received and e-cash minted" />
					<ProgressStage
						label="Publishing bid to relays"
						status={publishStage}
						description={isPublishFailed ? 'Failed to publish — retry available below' : undefined}
					/>
					<ProgressStage
						label="Awaiting validator check"
						status={validatorStage}
						description={
							hasPositiveVerdict
								? `Validator confirmed: ${representativeVerdict?.claim}`
								: hasNegativeVerdict
									? `Validator verdict: ${representativeVerdict?.claim}`
									: isAwaitingValidator && validatorPubkeys.length === 0
										? 'No validators configured for this auction'
										: isAwaitingValidator && hasNeutralVerdict
											? `Validator review pending (${representativeVerdict?.claim}) — awaiting final verdict`
											: isAwaitingValidator
												? 'Waiting for kind-30440 verdict from auction validators'
												: undefined
						}
					/>
				</div>

				{validatorPubkeys.length > 0 && (
					<div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
						<span>Validators:</span>
						{validatorPubkeys.map((pk) => (
							<AvatarUser key={pk} pubkey={pk} colored deterministicFallbackText className="h-5 w-5" />
						))}
					</div>
				)}

				<DialogFooter>
					{isPublishFailed && onRetryPublish && (
						<Button onClick={onRetryPublish} disabled={isPublishAttempted}>
							{isPublishAttempted ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin mr-2" />
									Retrying...
								</>
							) : (
								'Retry publish'
							)}
						</Button>
					)}
					<Button variant={isTerminal ? 'default' : 'outline'} onClick={onClose}>
						{isTerminal ? 'Done' : 'Close'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
