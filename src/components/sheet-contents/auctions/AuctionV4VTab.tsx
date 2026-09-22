import type { Dispatch, SetStateAction } from 'react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AlertTriangle, CheckCircle2, CircleDashed, Plus } from 'lucide-react'
import type { AuctionFormData } from '@/publish/auctions'
import { AUCTION_RECOMMENDED_VALIDATOR_POOL, AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS } from '@/lib/auction/auctionValidatorPolicy'
import {
	type MultipartyPickableRecipient,
	type MultipartyPickableValidator,
	describeValidatorTerms,
} from '@/lib/auction/multipartyAnnouncements'
import { useMultipartyAnnouncements } from '@/queries/multiparty'
import type { AuctionWorkflowResolution } from '@/lib/workflow/auctionWorkflowResolver'

export interface AuctionV4VTabProps {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
	/** The auditors the root will list, after the app-default fallback. */
	auditors: readonly string[]
	resolution: AuctionWorkflowResolution
	/** Append a validator's recipient line and add it to the auditor list. */
	onAddValidator: (validator: MultipartyPickableValidator) => void
	/** Append a plain recipient's line. */
	onAddRecipient: (recipient: MultipartyPickableRecipient) => void
}

const shortPubkey = (pubkey: string): string => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`

const formatBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`

/**
 * The V4V / validator step of the auction form.
 *
 * This tab is where the multiparty payout is set up: the validators whose verdicts
 * gate bid validity, and the recipients who share the settlement. It is a required
 * step — `resolveAuctionWorkflow` decides whether the draft is publishable, and the
 * publish action refuses (rather than silently publishing a single-party auction)
 * while anything blocking is listed here.
 *
 * Read-only by design where the data does not exist yet: a recipient's resolved
 * profile name, payout capability and validator offer come from relay reads that are
 * a later slice, so the rows say "awaiting reads" rather than showing a guess.
 */
export function AuctionV4VTab({ formData, setFormData, auditors, resolution, onAddValidator, onAddRecipient }: AuctionV4VTabProps) {
	const { validators, recipients, preview, blockingMessages } = resolution
	const recipientCount = recipients.length
	const isSingleParty = recipientCount === 0 && formData.payoutRecipients?.trim().length === 0
	const announcements = useMultipartyAnnouncements()

	return (
		<div className="space-y-6">
			{blockingMessages.length > 0 && (
				<div className="rounded-md border border-red-300 bg-red-50 p-3">
					<div className="flex items-center gap-2 text-sm font-semibold text-red-800">
						<AlertTriangle className="h-4 w-4" />
						This auction cannot be published yet
					</div>
					<ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-800">
						{blockingMessages.map((message) => (
							<li key={message}>{message}</li>
						))}
					</ul>
				</div>
			)}

			<div className="rounded-md border p-3">
				<div className="mb-2 flex items-center justify-between">
					<div className="text-xs font-semibold uppercase text-muted-foreground">Pick from announcements</div>
					<span className="text-xs text-muted-foreground">
						{announcements.isLoading
							? 'reading announcements…'
							: announcements.data
								? `${announcements.data.validators.length} validator(s), ${announcements.data.recipients.length} recipient(s)`
								: 'announcements unavailable'}
					</span>
				</div>

				{announcements.isError && (
					<p className="text-xs text-muted-foreground">
						Could not read announcements right now. You can still enter pubkeys by hand below.
					</p>
				)}

				{announcements.data && announcements.data.validators.length > 0 && (
					<ul className="space-y-2">
						{announcements.data.validators.map((validator) => (
							<li key={validator.pubkey} className="flex items-start gap-3 rounded-md border p-2">
								{validator.picture ? (
									<img src={validator.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" loading="lazy" />
								) : (
									<div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
								)}
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium">{validator.name ?? `${shortPubkey(validator.pubkey)} (unnamed)`}</div>
									<div className="text-xs text-muted-foreground">{describeValidatorTerms(validator)}</div>
									{validator.about && <div className="mt-0.5 text-xs text-muted-foreground">{validator.about}</div>}
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="shrink-0 gap-1 text-xs"
									onClick={() => onAddValidator(validator)}
								>
									<Plus className="h-3 w-3" />
									Add
								</Button>
							</li>
						))}
					</ul>
				)}

				{announcements.data && announcements.data.recipients.length > 0 && (
					<ul className="mt-2 space-y-2">
						{announcements.data.recipients.map((recipient) => (
							<li key={recipient.pubkey} className="flex items-start gap-3 rounded-md border p-2">
								{recipient.picture ? (
									<img src={recipient.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" loading="lazy" />
								) : (
									<div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
								)}
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium">{recipient.name ?? `${shortPubkey(recipient.pubkey)} (unnamed)`}</div>
									{recipient.about && <div className="text-xs text-muted-foreground">{recipient.about}</div>}
									<div className="text-xs text-muted-foreground">v4v recipient · share set by you</div>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="shrink-0 gap-1 text-xs"
									onClick={() => onAddRecipient(recipient)}
								>
									<Plus className="h-3 w-3" />
									Add
								</Button>
							</li>
						))}
					</ul>
				)}

				{announcements.data && announcements.data.validators.length === 0 && announcements.data.recipients.length === 0 && (
					<p className="text-xs text-muted-foreground">No announcements found on the app relay yet. Enter pubkeys by hand below.</p>
				)}
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-auditor-pubkeys">Validators (one pubkey per line)</Label>
				<textarea
					id="auction-auditor-pubkeys"
					value={formData.auditorPubkeys ?? ''}
					onChange={(e) => setFormData((prev) => ({ ...prev, auditorPubkeys: e.target.value }))}
					className="border-2 min-h-20 p-2 rounded-md font-mono text-xs"
					placeholder={'8f1c…\n2b7d…'}
				/>
				<div className="rounded-md bg-muted p-3 text-xs space-y-1">
					<div className="flex items-center gap-2">
						{validators.valid ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
						<span>
							{validators.poolSize} validator(s) listed · at least {validators.ruleset.minimum_validators} required ·{' '}
							{AUCTION_RECOMMENDED_VALIDATOR_POOL} recommended
						</span>
					</div>
					<div>
						An outcome needs {validators.requiredQuorum} of {validators.poolSize} validators to agree (more than half the pool). The
						seller's declared quorum may raise this, never lower it.
					</div>
					{validators.poolSize > 0 && validators.poolSize % 2 === 0 && (
						<div className="text-muted-foreground">
							Two validators must agree unanimously, so an even pool tolerates no validator being offline. An odd pool of{' '}
							{AUCTION_RECOMMENDED_VALIDATOR_POOL} tolerates one.
						</div>
					)}
					<div className="text-muted-foreground">Up to {AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS} validators per auction.</div>
				</div>
				{auditors.length !== validators.poolSize && (
					<p className="text-xs text-muted-foreground">{auditors.length} validator(s) resolved for this auction.</p>
				)}
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-payout-recipients">V4V recipients (optional, one per line)</Label>
				<textarea
					id="auction-payout-recipients"
					value={formData.payoutRecipients ?? ''}
					onChange={(e) => setFormData((prev) => ({ ...prev, payoutRecipients: e.target.value }))}
					className="border-2 min-h-24 p-2 rounded-md font-mono text-xs"
					placeholder={
						'role, pubkey, bps, capability_event_id[, offer_event_id]\n' + 'validator, 2f…, 625, a1…, b2…\n' + 'v4v, 3c…, 313, c3…'
					}
				/>
				<p className="text-xs text-muted-foreground">
					Leave empty for a normal single-party auction: the seller receives the whole settlement. With recipients, the auction publishes
					the multiparty payout schedule and its commitment, and the seller keeps whatever remains. Every validator listed here must also be
					one of the auction&apos;s validators above.
				</p>
			</div>

			{recipientCount > 0 && (
				<div className="rounded-md border p-3">
					<div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Payout schedule preview</div>
					<ul className="space-y-1 text-xs">
						{recipients.map((recipient) => (
							<li key={`${recipient.role}-${recipient.recipient_pubkey}`} className="flex items-center gap-2">
								<CircleDashed className="h-3 w-3 text-muted-foreground" />
								<span className="font-mono">{shortPubkey(recipient.recipient_pubkey)}</span>
								<span className="text-muted-foreground">{recipient.role}</span>
								<span>{formatBps(recipient.allocation_bps)}</span>
								<span className="text-muted-foreground">awaiting reads (capability, offer, presence)</span>
							</li>
						))}
					</ul>
					{preview !== null && (
						<div className="mt-3 space-y-1 border-t pt-2 text-xs text-muted-foreground">
							<div>
								Seller keeps {formatBps(preview.sellerRemainderBps)} · recipients share {formatBps(preview.auxiliaryAllocationBps)} across{' '}
								{preview.recipientCount} entry(ies).
							</div>
							<div className="font-mono">schedule commitment {preview.commitment.slice(0, 16)}…</div>
						</div>
					)}
				</div>
			)}

			{isSingleParty && (
				<p className="text-xs text-muted-foreground">No recipients: this publishes a single-party auction, unchanged from today.</p>
			)}
		</div>
	)
}
