import { useMemo, type Ref } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { buildV4VPayoutPreview, type V4VEndpointFact } from '@/lib/v4v/v4vPayoutPreview'
import type { V4VSplitRow } from '@/lib/v4v/splitAnnouncement'

/**
 * The seller's V4V split editor for the zap-payout model.
 *
 * Presentational on purpose: it renders what it is given and reports changes upward. Every number it
 * shows comes from `buildV4VPayoutPreview`, which composes the same modules the payout itself uses —
 * so this component cannot disagree with the run about what will be paid, and it contains no rule of
 * its own about shares, limits or statuses.
 *
 * The one thing it does own is the copy that explains the model to the seller, because that is a
 * presentation decision: the payment comes from **their wallet at settlement**, not from an escrow, and
 * a seller who does not know that has been misled about what they are promising.
 */
export interface V4VZapSplitEditorProps {
	readonly rows: readonly V4VSplitRow[]
	readonly onChange: (rows: readonly V4VSplitRow[]) => void
	/** The current bid, or the settled amount once there is one — the preview is only as real as this. */
	readonly settledSats: number
	readonly minimumZapSats?: number
	/** Endpoint facts by normalized destination, when a liveness check has been made. */
	readonly endpointFacts?: Readonly<Record<string, V4VEndpointFact>>
	readonly disabled?: boolean
	readonly commitment?: string
	readonly className?: string
	/** React 19 ref-as-prop, per the nostr/ component conventions. */
	readonly ref?: Ref<HTMLDivElement>
}

const DEFAULT_MINIMUM_ZAP_SATS = 10

export function V4VZapSplitEditor({
	rows,
	onChange,
	settledSats,
	minimumZapSats = DEFAULT_MINIMUM_ZAP_SATS,
	endpointFacts,
	disabled = false,
	commitment,
	className,
	ref,
}: V4VZapSplitEditorProps) {
	const preview = useMemo(
		() =>
			buildV4VPayoutPreview({
				rows,
				settledSats,
				minimumZapSats,
				...(endpointFacts ? { endpointFacts } : {}),
				...(commitment ? { commitment } : {}),
			}),
		[rows, settledSats, minimumZapSats, endpointFacts, commitment],
	)

	const update = (id: string, patch: Partial<V4VSplitRow>) => {
		onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
	}
	const remove = (id: string) => onChange(rows.filter((row) => row.id !== id))
	const add = () => {
		const nextId = String(Math.max(0, ...rows.map((row) => Number.parseInt(row.id, 10) || 0)) + 1)
		onChange([...rows, { id: nextId, destination: '', bps: 0 }])
	}

	return (
		<div ref={ref} className={cn('space-y-4', className)} data-testid="v4v-zap-split-editor">
			<div className="space-y-1">
				<Label>Value-for-value recipients</Label>
				<p className="text-muted-foreground text-sm">
					Each recipient is paid by a Lightning zap from <strong>your wallet</strong> when the auction settles. Your wallet pays it, not an
					escrow — so a recipient needs nothing but a Lightning address, and you pay what you announce here.
				</p>
			</div>

			<div className="space-y-3">
				{rows.map((row) => {
					const shown = preview.rows.find((entry) => entry.id === row.id)
					return (
						<div key={row.id} className="space-y-2 rounded-md border p-3" data-testid={`v4v-row-${row.id}`}>
							<div className="flex flex-wrap items-center gap-2">
								<Input
									aria-label={`Recipient ${row.id} Lightning address`}
									placeholder="name@domain, lnurl1…, or npub1…"
									value={row.destination}
									disabled={disabled}
									onChange={(event) => update(row.id, { destination: event.target.value })}
									className="min-w-[16rem] flex-1"
								/>
								<Input
									aria-label={`Recipient ${row.id} share in basis points`}
									type="number"
									min={0}
									max={10000}
									value={row.bps}
									disabled={disabled}
									onChange={(event) => update(row.id, { bps: Number.parseInt(event.target.value, 10) || 0 })}
									className="w-28"
								/>
								<span className="text-muted-foreground w-20 text-sm">{shown ? `${shown.percent}%` : ''}</span>
								<span className="w-28 text-sm">{shown ? `${shown.sats} sats` : ''}</span>
								<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => remove(row.id)}>
									Remove
								</Button>
							</div>
							{shown ? (
								<p className="text-muted-foreground text-sm" data-testid={`v4v-row-${row.id}-status`}>
									{shown.sentence}
									{shown.detail ? ` (${shown.detail})` : ''}
								</p>
							) : (
								<p className="text-muted-foreground text-sm">Not part of the split yet.</p>
							)}
						</div>
					)
				})}
			</div>

			<div className="flex items-center gap-2">
				<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add}>
					Add recipient
				</Button>
				{preview.ok ? (
					<span className="text-muted-foreground text-sm" data-testid="v4v-summary">
						{preview.totalBps / 100}% to recipients · {preview.willPaySats} sats will be paid · {preview.sellerSats} sats stay with you
						{preview.willNotPaySats > 0 ? ` · ${preview.willNotPaySats} sats will not be paid (see the rows)` : ''}
					</span>
				) : (
					<span className="text-destructive text-sm" data-testid="v4v-refusal">
						{preview.refusal?.rowId ? `Row ${preview.refusal.rowId}: ` : ''}
						{preview.refusal?.detail}
					</span>
				)}
			</div>

			{preview.warnings.length > 0 ? (
				<ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm" data-testid="v4v-warnings">
					{preview.warnings.map((warning) => (
						<li key={warning}>{warningCopy(warning, minimumZapSats)}</li>
					))}
				</ul>
			) : null}

			{preview.commitment ? (
				<p className="text-muted-foreground break-all text-xs" data-testid="v4v-commitment">
					Committed split: {preview.commitment.slice(0, 16)}…
				</p>
			) : null}
		</div>
	)
}

/** Presentation copy for the preview's warnings — the only judgement this file is allowed to make. */
function warningCopy(warning: string, minimumZapSats: number): string {
	switch (warning) {
		case 'no_rows':
			return 'Add at least one recipient, or remove the split entirely — an empty split pays nobody.'
		case 'seller_keeps_everything':
			return 'Every share is zero, so the whole settlement stays with you.'
		case 'row_will_not_be_paid':
			return 'At least one recipient will not be paid as announced — see the row for the reason.'
		case 'endpoint_facts_missing':
			return 'These addresses have not been checked yet. They will be checked again when the payout runs.'
		case 'commitment_missing':
			return 'Publishing this split will commit you to it, so it can be checked afterwards.'
		default:
			return `Notice: ${warning} (minimum zap ${minimumZapSats} sats).`
	}
}
