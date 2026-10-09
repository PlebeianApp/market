import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ProfileSearch } from '@/components/v4v/ProfileSearch'
import { RecipientItem } from '@/components/v4v/RecipientItem'
import { RecipientPreview } from '@/components/v4v/RecipientPreview'
import { allocationBarWidth, clampAllocation, sellerRemainder, type AllocationUnit } from '@/lib/v4v/allocations'
import type { V4VConfig, V4VLabels } from '@/lib/v4v/labels'
import type { V4VShare } from '@/lib/v4v/share'
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

/**
 * V4VManager — agnostic split editor.
 *
 * **Presentational and persistence-agnostic**: it owns no state, fetches nothing,
 * and publishes nothing. All data, handlers, copy (`labels`) and feature flags
 * (`config`) are injected by the call site, which is what declares *how* this
 * view is used.
 *
 * Three properties make it reusable rather than sales-shaped, and all three are
 * inputs rather than assumptions in this file:
 *
 * 1. **The unit is the call site's.** Every amount here is expressed in
 *    `config.allocation` — sales declares per cent (`PERCENT_UNIT`), an auction
 *    settlement declares basis points (`BPS_UNIT`). The component never divides by
 *    100 or appends `%`; it formats through the unit. That is what lets a validator
 *    announce 0.5% (50 bps) without the editor rounding it to 1%.
 * 2. **Rows can be fixed.** A share marked `locked` is rendered without a remove
 *    control or a slider — for an auction, the validators are already committed as
 *    the auction's auditors, so the payout editor must not silently drop or reprice
 *    them. Locked rows also hold their value through "equal up".
 * 3. **A recipient requirement is declared, not assumed.** The component asks
 *    `config.recipientRequirement` whether the thing a new recipient must satisfy
 *    (zap-capable for sales, a payout capability for auctions, nothing at all) holds
 *    for the typed recipient; it does not know what the requirement means.
 */
export interface V4VManagerProps {
	// --- data (injected by the caller's adapter hook) ---
	shares: V4VShare[]
	/** The total allocated to recipients, in `config.allocation`'s unit. */
	totalAllocated: number
	newRecipientNpub: string
	newRecipientAllocation: number
	showAddForm: boolean
	isChecking: boolean
	isSaving: boolean
	/** For the optional "changed/saved" indicator on the save button. */
	hasChanges?: boolean

	// --- computed viz values (injected; sales supplies emoji, others may omit) ---
	recipientColors?: Record<string, string>
	emoji?: string
	emojiSize?: number
	emojiClass?: string
	/** Show per-recipient zap-capability badges (sales-only). */
	showZapBadges?: boolean

	// --- handlers (callbacks; the component performs no business logic) ---
	onTotalChange: (value: number[]) => void
	onProfileSelect: (npub: string) => void
	onAddRecipient: () => void
	onRemoveRecipient: (id: string) => void
	onUpdateAllocation: (id: string, allocation: number) => void
	onEqualizeAll: () => void
	onSetNewRecipientAllocation: (value: number) => void
	onToggleAddForm: (open: boolean) => void
	onSave: () => void | Promise<void>
	onCancel?: () => void

	// --- the "how" declared by the call site ---
	labels: V4VLabels
	config: V4VConfig

	className?: string
}

export const V4VManager = forwardRef<HTMLDivElement, V4VManagerProps>(function V4VManager(
	{
		shares,
		totalAllocated,
		newRecipientNpub,
		newRecipientAllocation,
		showAddForm,
		isChecking,
		isSaving,
		hasChanges,
		recipientColors = {},
		emoji,
		emojiSize,
		emojiClass,
		showZapBadges = false,
		onTotalChange,
		onProfileSelect,
		onAddRecipient,
		onRemoveRecipient,
		onUpdateAllocation,
		onEqualizeAll,
		onSetNewRecipientAllocation,
		onToggleAddForm,
		onSave,
		onCancel,
		labels,
		config,
		className,
	},
	ref,
) {
	const unit: AllocationUnit = config.allocation
	const requirement = config.recipientRequirement
	const total = clampAllocation(totalAllocated, unit.total)
	const seller = sellerRemainder(total, unit)

	const lockedShares = shares.filter((share) => share.locked)
	const changeableShares = shares.filter((share) => !share.locked)
	/** An equal split is meaningless when nothing may move. */
	const canEqualize = changeableShares.length > 1

	const format = (value: number) => unit.format(clampAllocation(value, unit.total))

	const handleSave = () => {
		void onSave()
	}

	// Whether adding is allowed right now: something must be typed, a check must not be
	// running, a required requirement must not be known to have failed, and there has
	// to be an allocation to take the share from.
	const requirementBlocks = requirement.required && (requirement.checking || requirement.satisfied === false)
	const addDisabled = isChecking || !newRecipientNpub || requirementBlocks || total <= 0

	return (
		<div ref={ref} className={cn('space-y-6', className)}>
			{labels.alertText && (
				<Alert className="bg-blue-100 border-blue-200 text-blue-800">
					<AlertDescription>{labels.alertText}</AlertDescription>
				</Alert>
			)}

			<div className="space-y-4">
				<h2 className="font-semibold text-xl">{labels.totalSplitHeading}</h2>

				{/* Total slider: what leaves the payer and what they keep (gated by config) */}
				{config.showTotalSlider && (
					<div className="mt-4">
						<div className="flex justify-between mb-2 text-muted-foreground text-sm">
							<span>{labels.sellerLabel(format(seller))}</span>
							<span>{labels.v4vLabel(format(total))}</span>
						</div>
						<Slider value={[total]} min={0} max={unit.total} step={unit.step} onValueChange={onTotalChange} />
					</div>
				)}

				{/* Emoji animation section (sales-only; gated by config) */}
				{config.showEmoji && emoji && (
					<div className="my-8 text-center">
						<div
							className={cn('p-4 rounded-full bg-muted inline-flex items-center justify-center', emojiClass)}
							style={{
								fontSize: `${emojiSize}px`,
								width: `${(emojiSize ?? 0) * 1.5}px`,
								height: `${(emojiSize ?? 0) * 1.5}px`,
							}}
						>
							{emoji}
						</div>
					</div>
				)}

				{/* First bar - split between payer and recipients (gated by config) */}
				{config.showSellerBar && (
					<div className="flex rounded-md w-full h-12 overflow-hidden">
						<div
							className="flex justify-start items-center bg-green-600 pl-4 font-medium text-white"
							style={{ width: `${allocationBarWidth(seller, unit)}%` }}
						>
							{format(seller)}
						</div>
						{total > 0 && (
							<div
								className="flex justify-center items-center bg-fuchsia-500 font-medium text-white"
								style={{ width: `${allocationBarWidth(total, unit)}%` }}
							>
								V4V
							</div>
						)}
					</div>
				)}

				<h2 className="mt-4 font-semibold text-xl">{labels.recipientsHeading}</h2>

				{/* Second bar - split between recipients */}
				{shares.length > 0 && total > 0 ? (
					<div className="flex rounded-md w-full h-12 overflow-hidden">
						{shares.map((share) => (
							<div
								key={share.id}
								className="flex items-center justify-center text-white font-medium"
								style={{
									width: `${allocationBarWidth(share.bps, unit)}%`,
									backgroundColor: recipientColors[share.pubkey],
								}}
							>
								{format(share.bps)}
							</div>
						))}
					</div>
				) : (
					<div className="text-muted-foreground">{labels.emptyRecipientsText}</div>
				)}

				{/* Recipients list */}
				<div className="space-y-2 mt-2">
					{shares.map((share) => (
						<RecipientItem
							key={share.id}
							share={share}
							unit={unit}
							onRemove={onRemoveRecipient}
							onAllocationChange={onUpdateAllocation}
							color={recipientColors[share.pubkey]}
							lockedLabel={labels.lockedLabel}
							adjustHint={labels.adjustHint}
							showZapBadges={showZapBadges}
						/>
					))}
				</div>

				{lockedShares.length > 0 && changeableShares.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{lockedShares.length} {lockedShares.length === 1 ? 'participant is' : 'participants are'} fixed and keep their share; the rest
						can be changed.
					</p>
				)}

				{/* Add new recipient form */}
				{showAddForm ? (
					<div className="space-y-4 mt-6 p-4 border rounded-lg">
						<div className="flex-1">
							<ProfileSearch onSelect={onProfileSelect} placeholder={labels.searchPlaceholder} />

							{newRecipientNpub && (
								<RecipientPreview npub={newRecipientNpub} allocationLabel={format(newRecipientAllocation)} requirement={requirement} />
							)}
						</div>
						{shares.length > 0 && (
							<div className="space-y-2">
								<div className="flex justify-between text-muted-foreground text-sm">
									<span>{labels.newRecipientShareLabel(format(newRecipientAllocation))}</span>
								</div>
								<Slider
									value={[clampAllocation(newRecipientAllocation, unit.total)]}
									min={unit.step}
									max={unit.total}
									step={unit.step}
									onValueChange={(value) => onSetNewRecipientAllocation(value[0])}
								/>
							</div>
						)}
						<div className="flex flex-wrap items-center gap-2">
							<Button
								className="flex-grow sm:flex-grow-0"
								onClick={onAddRecipient}
								disabled={addDisabled}
								data-testid="add-v4v-recipient-button"
							>
								{labels.addFormConfirmText}
							</Button>
							<Button variant="outline" onClick={() => onToggleAddForm(false)} data-testid="cancel-v4v-recipient-button">
								{labels.addFormCancelText}
							</Button>
						</div>
					</div>
				) : (
					<div className="gap-4 grid grid-cols-1 sm:grid-cols-2 mt-6">
						<Button
							variant="outline"
							onClick={() => onToggleAddForm(true)}
							disabled={total <= 0}
							data-testid="add-v4v-recipient-form-button"
						>
							{labels.addRecipientButtonText}
						</Button>
						<Button variant="outline" onClick={onEqualizeAll} disabled={!canEqualize || total <= 0} data-testid="equal-all-v4v-button">
							{labels.equalizeAllButtonText}
						</Button>
					</div>
				)}

				{/* Save button */}
				{config.showSaveButton && (
					<div className="mt-6">
						{config.showCancelButton && onCancel ? (
							<div className="flex gap-2">
								<Button variant="outline" onClick={onCancel} className="flex-1">
									{labels.cancelButtonText}
								</Button>
								<Button
									variant="default"
									className="flex-1"
									onClick={handleSave}
									disabled={isSaving || (config.showChangesIndicator && !hasChanges)}
									data-testid={config.saveButtonTestId}
								>
									{isSaving
										? labels.savingText
										: config.showChangesIndicator && hasChanges
											? labels.saveButtonText
											: config.showChangesIndicator
												? labels.savedText
												: labels.saveButtonText}
								</Button>
							</div>
						) : (
							<Button
								variant="default"
								className="w-full"
								onClick={handleSave}
								disabled={isSaving || (config.showChangesIndicator && !hasChanges)}
								data-testid={config.saveButtonTestId}
							>
								{isSaving
									? labels.savingText
									: config.showChangesIndicator && hasChanges
										? labels.saveButtonText
										: config.showChangesIndicator
											? labels.savedText
											: labels.saveButtonText}
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	)
})
