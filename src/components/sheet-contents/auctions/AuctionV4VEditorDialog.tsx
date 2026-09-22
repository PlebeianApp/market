import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Lock } from 'lucide-react'
import type { AuctionFormData } from '@/publish/auctions'
import { describeRecipientFailure, resolveAuctionWorkflow, type AuctionWorkflowResolution } from '@/lib/workflow/auctionWorkflowResolver'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '@/lib/auction/multipartySchedule'
import { requiredVerdictMajority } from '@/lib/auction/verdictMajority'

export interface AuctionV4VEditorDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
	/** The auditors the root will list — fixed participants in this editor. */
	auditors: readonly string[]
}

const shortPubkey = (pubkey: string): string => `${pubkey.slice(0, 10)}…${pubkey.slice(-4)}`
const formatBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`

/**
 * The V4V editor.
 *
 * The validators chosen in the previous step appear here as **fixed participants**:
 * they are already committed as the auction's auditors, so their rows are locked and
 * cannot be removed from the payout. Only the *additional* V4V recipients are
 * editable, which is why the edits are transactional — nothing reaches the draft
 * until Save, so closing the dialog cannot half-apply a payout.
 *
 * The recipients are still entered as lines for now. The richer editor (the
 * `V4VManager` component used by the product flow, with per-recipient sliders, a
 * share preview and profile search) replaces this body next, with a `locked` flag on
 * the recipient items so the validator rows stay frozen there too; the line format is
 * what that component will write as well.
 */
export function AuctionV4VEditorDialog({ open, onOpenChange, formData, setFormData, auditors }: AuctionV4VEditorDialogProps) {
	const [draft, setDraft] = useState(formData.payoutRecipients ?? '')
	const [preview, setPreview] = useState<AuctionWorkflowResolution | null>(null)

	// Reset the draft from the live form each time the dialog opens, so a cancelled
	// edit is never resurrected.
	useEffect(() => {
		if (open) setDraft(formData.payoutRecipients ?? '')
	}, [open, formData.payoutRecipients])

	useEffect(() => {
		setPreview(
			resolveAuctionWorkflow({
				mode: 'create',
				auditors,
				auditor_quorum: formData.auditorQuorum ?? requiredVerdictMajority(auditors.length),
				settlement_policy: draft.trim().length > 0 ? AUCTION_MULTIPARTY_SETTLEMENT_POLICY : undefined,
				recipientLines: draft,
				sellerPubkey: '',
			}),
		)
	}, [draft, auditors, formData.auditorQuorum])

	const blocking = preview?.issues.filter((entry) => entry.severity === 'blocking') ?? []

	const save = () => {
		setFormData((prev) => ({ ...prev, payoutRecipients: draft }))
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>V4V recipients</DialogTitle>
					<DialogDescription>
						Who shares the settlement. The seller keeps whatever is left, and the schedule is committed when the auction is published — it
						cannot be changed afterwards without re-publishing.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-5 py-2">
					<div className="space-y-2">
						<Label className="text-xs uppercase text-muted-foreground">Fixed participants ({auditors.length})</Label>
						{auditors.length === 0 && (
							<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
								No validator chosen yet. Go back one step and pick the validators for this auction.
							</p>
						)}
						{auditors.map((pubkey) => (
							<div key={pubkey} className="flex items-center gap-3 rounded-md border bg-muted/40 p-2">
								<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
								<span className="font-mono text-xs">{shortPubkey(pubkey)}</span>
								<span className="text-xs text-muted-foreground">validator · always takes part in the payout</span>
							</div>
						))}
					</div>

					<div className="grid w-full gap-1.5">
						<Label htmlFor="v4v-recipient-lines">Other V4V recipients (one per line)</Label>
						<textarea
							id="v4v-recipient-lines"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							className="border-2 min-h-28 p-2 rounded-md font-mono text-xs"
							placeholder={
								'role, pubkey, bps, capability_event_id[, offer_event_id]\n' + 'validator, 2f…, 625, a1…, b2…\n' + 'v4v, 3c…, 313, c3…'
							}
						/>
						<p className="text-xs text-muted-foreground">Leave empty to pay the seller alone. Basis points, so 625 is 6.25%.</p>
					</div>

					{preview && preview.recipients.length > 0 && (
						<div className="rounded-md border p-3 text-xs">
							<div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Payout schedule</div>
							<ul className="space-y-1">
								{preview.recipients.map((recipient) => (
									<li key={`${recipient.role}-${recipient.recipient_pubkey}`} className="flex items-center gap-2">
										<span className="font-mono">{shortPubkey(recipient.recipient_pubkey)}</span>
										<span className="text-muted-foreground">{recipient.role}</span>
										<span>{formatBps(recipient.allocation_bps)}</span>
									</li>
								))}
							</ul>
							{preview.preview && (
								<div className="mt-2 border-t pt-2 text-muted-foreground">
									Seller keeps {formatBps(preview.preview.sellerRemainderBps)} · recipients share{' '}
									{formatBps(preview.preview.auxiliaryAllocationBps)} · commitment{' '}
									<span className="font-mono">{preview.preview.commitment.slice(0, 16)}…</span>
								</div>
							)}
						</div>
					)}

					{blocking.length > 0 && (
						<div className="rounded-md border border-red-300 bg-red-50 p-3">
							<div className="flex items-center gap-2 text-xs font-semibold text-red-800">
								<AlertTriangle className="h-4 w-4" />
								This payout cannot be published yet
							</div>
							<ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-800">
								{blocking.map((entry) => (
									<li key={entry.code}>{entry.message || describeRecipientFailure(entry.code)}</li>
								))}
							</ul>
						</div>
					)}
				</div>

				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button type="button" variant="secondary" disabled={blocking.length > 0} onClick={save}>
						Save payout
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
