/**
 * Bid submission progress dialog — a single modal that tracks the entire
 * bid lifecycle from e-cash funding through relay publication to
 * third-party validator (kind-30440) confirmation.
 *
 * Protocol stages per AUCTIONS.md:
 *
 *   Funding phase (when deposit is needed):
 *     1a. Invoice created (Lightning invoice for selected mint)
 *     1b. Payment acknowledged (wallet detects payment)
 *     1c. E-cash minted (mint returns P2PK-locked proofs)
 *
 *   Publication phase:
 *     2. Locking e-cash (P2PK lock with seller child pubkey + refund timelock)
 *     3. Publishing bid to relays (kind-1023 event signed and published)
 *
 *   Validation phase:
 *     4. Validator checks bid (kind-30440 verdict — rules + NUT-7 proof state)
 *     5. Bid confirmed (valid_bid_placed from at least one auditor)
 *
 * The dialog does NOT auto-close. The user dismisses it explicitly after
 * a terminal state (confirmed, rejected, or failed).
 */

import { useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Check, AlertCircle } from 'lucide-react'
import { useAuctionVerdicts } from '@/queries/auctions'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import type { ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { computeVerdictQuorum, type VerdictQuorumResult } from '@/lib/auction/verdictQuorum'
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
	bidEventId?: string
	auditorQuorum?: number
	bidAmount?: number
	refundLocktime?: number
	onRetryPublish?: () => void
}

type StageStatus = 'done' | 'active' | 'pending' | 'error'

/**
 * Quorum result shown while the current funding session has not yet produced a
 * published bid event id (#1235 Blocking 5): no verdicts bound, nothing
 * confirmed, nothing condemned.
 */
const NO_SESSION_VERDICT_QUORUM: VerdictQuorumResult = {
	representativeVerdict: null,
	confirmCount: 0,
	condemnCount: 0,
	hasPositiveVerdict: false,
	hasNegativeVerdict: false,
	hasNeutralVerdict: false,
}

/**
 * #1235 Blocking 5 — cross-leg verdict leak: verdict binding is scoped to the
 * CURRENT session's published bid event.
 *
 * The dialog must never display a validator verdict bound to an event id
 * other than the bid published in the current session. `bidEventId` is
 * undefined until the current session's publish attempt produced an id (e.g.
 * a rebid's new leg at `ecash_minted` / `bid_publish_attempted`); until then
 * NO verdict may be attributed to the bid at all — `computeVerdictQuorum`
 * without an id falls back to a legacy no-filter mode that would happily
 * count the PREVIOUS leg's confirm verdicts and render "Bid successfully
 * placed!" for a bid that has not been published yet.
 *
 * Exported for unit tests (the dialog itself is portal-rendered, so its output
 * is not directly assertable in the SSR-based unit suite).
 */
export const resolveProgressDialogVerdictQuorum = (
	verdicts: ParsedValidatorVerdictEvent[],
	bidEventId: string | undefined,
	validatorPubkeys: string[],
	auditorQuorum: number | undefined,
): VerdictQuorumResult =>
	bidEventId ? computeVerdictQuorum(verdicts, bidEventId, validatorPubkeys, auditorQuorum) : NO_SESSION_VERDICT_QUORUM

// Lifecycle state groups
const FUNDING_STATES: ReadonlySet<string> = new Set([
	'funding_session_created',
	'invoice_created',
	'payment_acknowledged',
	'minting_started',
])
const FUNDING_DONE_STATES: ReadonlySet<string> = new Set([
	'ecash_minted',
	'ecash_minted_pending_rules_ack',
	'bid_publish_attempted',
	'bid_published',
])
const FUNDING_FAILED_STATES: ReadonlySet<string> = new Set([
	'invoice_unpaid_or_expired_reclaimable',
	'invoice_paid_mint_failed_reclaimable',
])
const PUBLISH_ACTIVE_STATES: ReadonlySet<string> = new Set(['bid_publish_attempted'])
const PUBLISH_DONE_STATES: ReadonlySet<string> = new Set(['bid_published'])
const PUBLISH_FAILED_STATES: ReadonlySet<string> = new Set(['mint_succeeded_bid_publish_failed_reclaimable'])

function ProgressStage({ label, status, description }: { label: string; status: StageStatus; description?: string }) {
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

function formatLocktime(unixSeconds: number): string {
	if (!unixSeconds || unixSeconds <= 0) return ''
	try {
		return new Date(unixSeconds * 1000).toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
		})
	} catch {
		return ''
	}
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
	bidAmount,
	refundLocktime,
	onRetryPublish,
}: AuctionBidProgressDialogProps) {
	const verdictsQuery = useAuctionVerdicts(auctionRootEventId, 500, auctionCoordinates)

	const parsedVerdicts = useMemo(
		() =>
			(verdictsQuery.data ?? [])
				.map(parseValidatorVerdictEvent)
				.filter((r): r is { ok: true; value: ParsedValidatorVerdictEvent } => r.ok)
				.map((r) => r.value),
		[verdictsQuery.data],
	)

	const { representativeVerdict, hasPositiveVerdict, hasNegativeVerdict, hasNeutralVerdict } = useMemo(
		() => resolveProgressDialogVerdictQuorum(parsedVerdicts, bidEventId, validatorPubkeys, auditorQuorum),
		[parsedVerdicts, bidEventId, validatorPubkeys, auditorQuorum],
	)

	const isFundingActive = FUNDING_STATES.has(lifecycleState)
	const isFundingDone = FUNDING_DONE_STATES.has(lifecycleState)
	const isFundingFailed = FUNDING_FAILED_STATES.has(lifecycleState)
	const isPublishActive = PUBLISH_ACTIVE_STATES.has(lifecycleState)
	const isPublishDone = PUBLISH_DONE_STATES.has(lifecycleState)
	const isPublishFailed = PUBLISH_FAILED_STATES.has(lifecycleState)

	const isAwaitingValidator = isPublishDone && !hasPositiveVerdict && !hasNegativeVerdict

	const isTerminal = hasPositiveVerdict || hasNegativeVerdict || isPublishFailed || isFundingFailed

	// Stage statuses
	const fundingStage: StageStatus = isFundingFailed ? 'error' : isFundingDone ? 'done' : isFundingActive ? 'active' : 'pending'

	const lockStage: StageStatus = isPublishFailed
		? 'error'
		: isPublishActive || isPublishDone
			? 'done'
			: isFundingDone
				? 'active'
				: 'pending'

	const publishStage: StageStatus = isPublishFailed ? 'error' : isPublishDone ? 'done' : isPublishActive ? 'active' : 'pending'

	const validatorStage: StageStatus = hasPositiveVerdict
		? 'done'
		: hasNegativeVerdict
			? 'error'
			: isAwaitingValidator && validatorPubkeys.length > 0
				? 'active'
				: 'pending'

	// Funding sub-step label (more granular within the funding stage)
	const fundingDescription = (() => {
		switch (lifecycleState) {
			case 'funding_session_created':
				return 'Creating Lightning invoice...'
			case 'invoice_created':
				return 'Invoice generated — waiting for payment'
			case 'payment_acknowledged':
				return 'Payment received — minting e-cash...'
			case 'minting_started':
				return 'Mint processing proofs...'
			case 'ecash_minted':
			case 'ecash_minted_pending_rules_ack':
				return 'E-cash minted with P2PK lock'
			default:
				return undefined
		}
	})()

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{hasPositiveVerdict ? (
							<Check className="w-5 h-5 text-green-500" />
						) : isFundingFailed || isPublishFailed || hasNegativeVerdict ? (
							<AlertCircle className="w-5 h-5 text-destructive" />
						) : (
							<Loader2 className="w-5 h-5 animate-spin text-blue-500" />
						)}
						{hasPositiveVerdict
							? 'Bid successfully placed!'
							: isFundingFailed
								? 'Funding Failed'
								: isPublishFailed
									? 'Bid Publish Failed'
									: hasNegativeVerdict
										? 'Bid Rejected'
										: 'Placing Your Bid'}
					</DialogTitle>
					<DialogDescription>
						{hasPositiveVerdict
							? `Your bid of ${bidAmount?.toLocaleString() ?? ''} sats has been published and validated by the auction validators.`
							: isFundingFailed
								? 'The Lightning payment could not be completed. Your funds are reclaimable.'
								: isPublishFailed
									? 'Your e-cash was minted but the bid could not be published to relays. You can retry or reclaim your funds.'
									: hasNegativeVerdict
										? `A validator has flagged this bid: ${representativeVerdict?.claim ?? 'rejected'}`
										: 'Tracking your bid through confirmation stages.'}
					</DialogDescription>
				</DialogHeader>

				{hasPositiveVerdict ? (
					/* Success summary — bid amount + refund locktime */
					<div className="space-y-3 py-2">
						<div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
							<Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
							<p className="text-2xl font-bold text-green-700">{bidAmount?.toLocaleString() ?? 0} sats</p>
							<p className="text-sm text-green-600 mt-1">bid locked</p>
						</div>
						{refundLocktime && refundLocktime > 0 && (
							<div className="flex items-center justify-between text-xs text-muted-foreground px-1">
								<span>Refund available after:</span>
								<span className="font-medium text-foreground">{formatLocktime(refundLocktime)}</span>
							</div>
						)}
						<div className="space-y-1 pt-1">
							<ProgressStage label="E-cash funded" status="done" />
							<ProgressStage label="P2PK lock applied" status="done" />
							<ProgressStage label="Bid published to relays" status="done" description="Kind-1023 event with P2PK lock" />
							<ProgressStage
								label="Validator confirmed"
								status="done"
								description={representativeVerdict ? `Verdict: ${representativeVerdict.claim}` : undefined}
							/>
						</div>
					</div>
				) : (
					/* Active/error stepper — shows all protocol stages */
					<div className="space-y-1 py-2">
						<ProgressStage
							label="Funding e-cash"
							status={fundingStage}
							description={
								isFundingFailed ? 'Lightning payment failed or expired' : isFundingDone ? 'E-cash minted and ready' : fundingDescription
							}
						/>
						<ProgressStage
							label="Locking e-cash (P2PK)"
							status={lockStage}
							description={
								isPublishFailed
									? undefined
									: lockStage === 'done'
										? 'Seller child pubkey + refund timelock applied'
										: lockStage === 'active'
											? 'Deriving path and applying NUT-11 lock...'
											: undefined
							}
						/>
						<ProgressStage
							label="Publishing bid to relays"
							status={publishStage}
							description={
								isPublishFailed
									? 'Failed to publish — retry available below'
									: isPublishDone
										? 'Kind-1023 event published'
										: isPublishActive
											? 'Signing and broadcasting kind-1023...'
											: undefined
							}
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
				)}

				{validatorPubkeys.length > 0 && !hasPositiveVerdict && (
					<div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
						<span>Validators:</span>
						{validatorPubkeys.map((pk) => (
							// `colored`/`deterministicFallbackText` are not AvatarUser props —
							// PR-introduced tsc error class, fixed for this file's instance only.
							<AvatarUser key={pk} pubkey={pk} className="h-5 w-5" />
						))}
					</div>
				)}

				<DialogFooter>
					{isPublishFailed && onRetryPublish && (
						<Button onClick={onRetryPublish} disabled={isPublishActive}>
							{isPublishActive ? (
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
						{isTerminal ? 'Done' : 'Cancel'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
