import { useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle } from 'lucide-react'
import { V4VManager } from '@/components/v4v/V4VManager'
import type { AuctionFormData } from '@/publish/auctions'
import { useAuctionV4VManager } from '@/hooks/useAuctionV4VManager'
import { auctionV4VManagerProps } from '@/lib/v4v/auction-props'
import { useMultipartyAnnouncements } from '@/queries/multiparty'
import { resolveAuctionWorkflow } from '@/lib/workflow/auctionWorkflowResolver'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '@/lib/auction/multipartySchedule'
import { requiredVerdictMajority } from '@/lib/auction/verdictMajority'
import type { AuctionValidatorInput } from '@/lib/v4v/auction-schedule'

export interface AuctionV4VEditorDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
	/** The auditors the root will list — the fixed participants in this editor. */
	auditors: readonly string[]
	/** The app's own pubkey, seeded as a recipient at the product flow's default share. */
	platformPubkey?: string | undefined
}

/**
 * The auction's V4V editor.
 *
 * It is the **same component the product and circular-economy surfaces use**
 * (`V4VManager`), driven by an auction adapter: the validators chosen in the previous
 * step appear as fixed rows, amounts are in basis points so a validator's announced fee
 * survives exactly, and Plebian Market is seeded as a recipient at the product flow's
 * default share.
 *
 * What differs from those surfaces is where a save goes. The product editor publishes
 * the seller's account-level V4V settings (kind 30078); here a save writes the schedule
 * into the auction draft, and the schedule is committed inside the auction root when the
 * auction is published. Reusing the component without reusing the storage is the point of
 * the adapter split — the two surfaces share the editor, not the persistence.
 */
export function AuctionV4VEditorDialog({
	open,
	onOpenChange,
	formData,
	setFormData,
	auditors,
	platformPubkey,
}: AuctionV4VEditorDialogProps) {
	const announcements = useMultipartyAnnouncements()

	// The validators the V4V step selected, with the terms they announced. A selected
	// validator with no announcement keeps its row but cannot be priced by this editor.
	const validators: AuctionValidatorInput[] = useMemo(() => {
		const announced = announcements.data?.validators ?? []
		return auditors.map((pubkey) => {
			const match = announced.find((validator) => validator.pubkey.toLowerCase() === pubkey.toLowerCase())
			return {
				pubkey,
				name: match?.name,
				feeBps: match?.feeBps ?? 0,
				capabilityEventId: match?.capabilityEventId ?? '',
				offerEventId: match?.offerEventId ?? '',
			}
		})
	}, [auditors, announcements.data])

	const manager = useAuctionV4VManager({
		open,
		recipientLines: formData.payoutRecipients ?? '',
		validators,
		recipients: announcements.data?.recipients ?? [],
		platformPubkey,
		onSave: (lines) => {
			setFormData((prev) => ({ ...prev, payoutRecipients: lines }))
			onOpenChange(false)
		},
	})

	// What the draft would refuse at publish, shown here so the seller learns it while
	// editing rather than from a disabled button.
	const blocking = useMemo(() => {
		const resolution = resolveAuctionWorkflow({
			mode: 'create',
			auditors,
			auditor_quorum: formData.auditorQuorum ?? requiredVerdictMajority(auditors.length),
			settlement_policy: manager.shares.length > 0 ? AUCTION_MULTIPARTY_SETTLEMENT_POLICY : undefined,
			recipientLines: formData.payoutRecipients ?? '',
			sellerPubkey: '',
		})
		return resolution.blockingMessages
	}, [auditors, formData.auditorQuorum, formData.payoutRecipients, manager.shares.length])

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

				{(manager.blocking.length > 0 || blocking.length > 0) && (
					<div className="rounded-md border border-red-300 bg-red-50 p-3">
						<div className="flex items-center gap-2 text-xs font-semibold text-red-800">
							<AlertTriangle className="h-4 w-4" />
							This payout cannot be published yet
						</div>
						<ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-800">
							{manager.blocking.map((row) => (
								<li key={row.id}>{row.reason}</li>
							))}
							{blocking.map((message) => (
								<li key={message}>{message}</li>
							))}
						</ul>
					</div>
				)}

				<div className="space-y-6 py-4">
					<V4VManager {...auctionV4VManagerProps(manager)} onCancel={() => onOpenChange(false)} />
				</div>
			</DialogContent>
		</Dialog>
	)
}
