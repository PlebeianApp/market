import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ProfileSearch } from '@/components/v4v/ProfileSearch'
import { RecipientItem } from '@/components/v4v/RecipientItem'
import { RecipientPreview } from '@/components/v4v/RecipientPreview'
import type { V4VConfig, V4VLabels } from '@/lib/v4v/labels'
import { cn } from '@/lib/utils'
import type { V4VDTO } from '@/lib/stores/cart'
import { forwardRef } from 'react'

/**
 * V4VManager — agnostic V4V / split editor.
 *
 * This component is **presentational and persistence-agnostic**: it owns no
 * state, fetches nothing, and publishes nothing. All data, handlers, copy
 * (`labels`) and feature flags (`config`) are injected by the call site, which
 * is what declares *how* this view is used (e.g. the sales / "all products"
 * dashboard route supplies the sales hook + sales labels + sales config).
 *
 * A future auction consumer can render the same component with a different
 * adapter, labels, and config (e.g. `showEmoji: false`, `requireZapCapable:
 * false`) without changing this file.
 */
export interface V4VManagerProps {
	// --- data (injected by the caller's adapter hook) ---
	shares: V4VDTO[]
	totalV4VPercentage: number
	newRecipientNpub: string
	newRecipientShare: number
	showAddForm: boolean
	canReceiveZaps?: boolean | undefined
	isCheckingZap: boolean
	isChecking: boolean
	isSaving: boolean
	/** For the optional "changed/saved" indicator on the save button. */
	hasChanges?: boolean

	// --- computed viz values (injected; sales adapter supplies emoji, others may omit) ---
	sellerPercentage?: number
	formattedSellerPercentage?: string
	formattedTotalV4V?: string
	recipientColors?: Record<string, string>
	emoji?: string
	emojiSize?: number
	emojiClass?: string

	// --- handlers (callbacks; the component performs no business logic) ---
	onTotalV4VPercentageChange: (value: number[]) => void
	onProfileSelect: (npub: string) => void
	onAddRecipient: () => void
	onRemoveRecipient: (id: string) => void
	onUpdatePercentage: (id: string, percentage: number) => void
	onEqualizeAll: () => void
	onSetNewRecipientShare: (value: number) => void
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
		totalV4VPercentage,
		newRecipientNpub,
		newRecipientShare,
		showAddForm,
		canReceiveZaps,
		isCheckingZap,
		isChecking,
		isSaving,
		hasChanges,
		sellerPercentage = 0,
		formattedSellerPercentage = '0',
		formattedTotalV4V = '0',
		recipientColors = {},
		emoji,
		emojiSize,
		emojiClass,
		onTotalV4VPercentageChange,
		onProfileSelect,
		onAddRecipient,
		onRemoveRecipient,
		onUpdatePercentage,
		onEqualizeAll,
		onSetNewRecipientShare,
		onToggleAddForm,
		onSave,
		onCancel,
		labels,
		config,
		className,
	},
	ref,
) {
	const handleSave = () => {
		void onSave()
	}

	// Whether adding a recipient is allowed right now. The sales adapter requires
	// recipients to be zap-capable; an auction adapter sets requireZapCapable:false.
	const addDisabled =
		isChecking || isCheckingZap || !newRecipientNpub || (config.requireZapCapable && !canReceiveZaps) || totalV4VPercentage === 0

	return (
		<div ref={ref} className={cn('space-y-6', className)}>
			{labels.alertText && (
				<Alert className="bg-blue-100 border-blue-200 text-blue-800">
					<AlertDescription>{labels.alertText}</AlertDescription>
				</Alert>
			)}

			<div className="space-y-4">
				<h2 className="font-semibold text-xl">{labels.totalSplitHeading}</h2>

				{/* Total V4V percentage slider (sales-only; gated by config) */}
				{config.showTotalSlider && (
					<div className="mt-4">
						<div className="flex justify-between mb-2 text-muted-foreground text-sm">
							<span>{labels.sellerLabel(formattedSellerPercentage)}</span>
							<span>{labels.v4vLabel(formattedTotalV4V)}</span>
						</div>
						<Slider value={[totalV4VPercentage]} min={0} max={100} step={1} onValueChange={onTotalV4VPercentageChange} />
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

				{/* First bar - Total split between seller and V4V (sales-only; gated by config) */}
				{config.showSellerBar && (
					<div className="flex rounded-md w-full h-12 overflow-hidden">
						<div
							className="flex justify-start items-center bg-green-600 pl-4 font-medium text-white"
							style={{ width: `${sellerPercentage}%` }}
						>
							{formattedSellerPercentage}%
						</div>
						{totalV4VPercentage > 0 && (
							<div
								className="flex justify-center items-center bg-fuchsia-500 font-medium text-white"
								style={{ width: `${totalV4VPercentage}%` }}
							>
								V4V
							</div>
						)}
					</div>
				)}

				<h2 className="mt-6 font-semibold text-xl">{labels.recipientsHeading}</h2>

				{/* Second bar - Split between V4V recipients */}
				{shares.length > 0 && totalV4VPercentage > 0 ? (
					<div className="flex rounded-md w-full h-12 overflow-hidden">
						{shares.map((share, index) => (
							<div
								key={share.id}
								className={`${index === 0 ? 'bg-rose-500' : 'bg-gray-500'} flex items-center justify-center text-white font-medium`}
								style={{
									width: `${share.percentage * 100}%`,
									backgroundColor: recipientColors[share.pubkey],
								}}
							>
								{(share.percentage * 100).toFixed(1)}%
							</div>
						))}
					</div>
				) : (
					<div className="text-muted-foreground">{labels.emptyRecipientsText}</div>
				)}

				{/* Recipients list */}
				<div className="space-y-2 mt-4">
					{shares.map((share) => (
						<RecipientItem
							key={share.id}
							share={{
								...share,
								percentage: share.percentage,
							}}
							onRemove={onRemoveRecipient}
							onPercentageChange={onUpdatePercentage}
							color={recipientColors[share.pubkey]}
						/>
					))}
				</div>

				{/* Add new recipient form */}
				{showAddForm ? (
					<div className="space-y-4 mt-6 p-4 border rounded-lg">
						<div className="flex-1">
							<ProfileSearch onSelect={onProfileSelect} placeholder={labels.searchPlaceholder} />

							{newRecipientNpub && (
								<RecipientPreview
									npub={newRecipientNpub}
									percentage={newRecipientShare}
									canReceiveZaps={canReceiveZaps}
									isLoading={isCheckingZap}
								/>
							)}
						</div>
						{shares.length > 0 && (
							<div className="space-y-2">
								<div className="flex justify-between text-muted-foreground text-sm">
									<span>{labels.newRecipientShareLabel(newRecipientShare)}</span>
								</div>
								<Slider
									value={[newRecipientShare]}
									min={1}
									max={100}
									step={1}
									onValueChange={(value) => onSetNewRecipientShare(value[0])}
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
							disabled={totalV4VPercentage === 0}
							data-testid="add-v4v-recipient-form-button"
						>
							{labels.addRecipientButtonText}
						</Button>
						<Button
							variant="outline"
							onClick={onEqualizeAll}
							disabled={shares.length === 0 || totalV4VPercentage === 0}
							data-testid="equal-all-v4v-button"
						>
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
