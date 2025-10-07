import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ProfileSearch } from '@/components/v4v/ProfileSearch'
import { RecipientItem } from '@/components/v4v/RecipientItem'
import { RecipientPreview } from '@/components/v4v/RecipientPreview'
import { useV4VManager } from '@/hooks/useV4VManager'
import type { V4VDTO } from '@/lib/stores/cart'
import '@/routes/_dashboard-layout/dashboard/sales/emoji-animations.css'

interface V4VManagerProps {
	userPubkey: string
	initialShares?: V4VDTO[]
	initialTotalPercentage?: number
	onSaveSuccess?: () => void
	showSaveButton?: boolean
	saveButtonText?: string
	saveButtonTestId?: string
	showChangesIndicator?: boolean
	hasChanges?: boolean
	className?: string
	showCancelButton?: boolean
	onCancel?: () => void
}

export function V4VManager({
	userPubkey,
	initialShares = [],
	initialTotalPercentage = 10,
	onSaveSuccess,
	showSaveButton = true,
	saveButtonText = 'Save Changes',
	saveButtonTestId = 'save-v4v-button',
	showChangesIndicator = false,
	hasChanges = false,
	className = '',
	showCancelButton = false,
	onCancel,
}: V4VManagerProps) {
	const {
		// State
		showAddForm,
		setShowAddForm,
		newRecipientNpub,
		newRecipientShare,
		setNewRecipientShare,
		localShares,
		isChecking,
		totalV4VPercentage,
		canReceiveZaps,
		isCheckingZap,
		publishMutation,

		// Computed values
		sellerPercentage,
		formattedSellerPercentage,
		formattedTotalV4V,
		recipientColors,
		emojiSize,
		emojiClass,
		emoji,

		// Handlers
		handleTotalV4VPercentageChange,
		handleProfileSelect,
		handleAddRecipient,
		handleRemoveRecipient,
		handleUpdatePercentage,
		handleEqualizeAll,
		saveShares,
	} = useV4VManager({
		userPubkey,
		initialShares,
		initialTotalPercentage,
		onSaveSuccess,
	})

	const handleSave = async () => {
		await saveShares()
	}

	return (
		<div className={`space-y-6 ${className}`}>
			<Alert className="bg-blue-100 text-blue-800 border-blue-200">
				<AlertDescription>
					PM (Beta) Is Powered By Your Generosity. Your Contribution Is The Only Thing That Enables Us To Continue Creating Free And Open
					Source Solutions 🙏
				</AlertDescription>
			</Alert>

			<div className="space-y-4">
				<h2 className="text-xl font-semibold">Split of total sales</h2>

				{/* Total V4V percentage slider */}
				<div className="mt-4">
					<div className="flex justify-between text-sm text-muted-foreground mb-2">
						<span>Seller: {formattedSellerPercentage}%</span>
						<span>V4V: {formattedTotalV4V}%</span>
					</div>
					<Slider value={[totalV4VPercentage]} min={0} max={100} step={1} onValueChange={handleTotalV4VPercentageChange} />
				</div>

				{/* Emoji animation section */}
				<div className="text-center my-8">
					<div
						className={`p-4 rounded-full bg-gray-200 inline-flex items-center justify-center ${emojiClass}`}
						style={{
							fontSize: `${emojiSize}px`,
							width: `${emojiSize * 1.5}px`,
							height: `${emojiSize * 1.5}px`,
						}}
					>
						{emoji}
					</div>
				</div>

				{/* First bar - Total split between seller and V4V */}
				<div className="w-full h-12 flex rounded-md overflow-hidden">
					<div
						className="bg-green-600 flex items-center justify-start pl-4 text-white font-medium"
						style={{ width: `${sellerPercentage}%` }}
					>
						{formattedSellerPercentage}%
					</div>
					{totalV4VPercentage > 0 && (
						<div
							className="bg-fuchsia-500 flex items-center justify-center text-white font-medium"
							style={{ width: `${totalV4VPercentage}%` }}
						>
							V4V
						</div>
					)}
				</div>

				<h2 className="text-xl font-semibold mt-6">V4V split between recipients</h2>

				{/* Second bar - Split between V4V recipients */}
				{localShares.length > 0 && totalV4VPercentage > 0 ? (
					<div className="w-full h-12 flex rounded-md overflow-hidden">
						{localShares.map((share, index) => (
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
					<div className="text-gray-500">No V4V recipients added yet</div>
				)}

				{/* Recipients list */}
				<div className="space-y-2 mt-4">
					{localShares.map((share) => (
						<RecipientItem
							key={share.id}
							share={{
								...share,
								percentage: share.percentage,
							}}
							onRemove={handleRemoveRecipient}
							onPercentageChange={handleUpdatePercentage}
							color={recipientColors[share.pubkey]}
						/>
					))}
				</div>

				{/* Add new recipient form */}
				{showAddForm ? (
					<div className="space-y-4 mt-6 border p-4 rounded-lg">
						<div className="flex-1">
							<ProfileSearch onSelect={handleProfileSelect} placeholder="Search profiles or paste npub..." />

							{newRecipientNpub && (
								<RecipientPreview
									npub={newRecipientNpub}
									percentage={newRecipientShare}
									canReceiveZaps={canReceiveZaps}
									isLoading={isCheckingZap}
								/>
							)}
						</div>
						{localShares.length > 0 && (
							<div className="space-y-2">
								<div className="flex justify-between text-sm text-muted-foreground">
									<span>Share percentage: {newRecipientShare}%</span>
								</div>
								<Slider value={[newRecipientShare]} min={1} max={100} step={1} onValueChange={(value) => setNewRecipientShare(value[0])} />
							</div>
						)}
						<div className="flex flex-wrap gap-2 items-center">
							<Button
								className="flex-grow sm:flex-grow-0"
								onClick={handleAddRecipient}
								disabled={isChecking || isCheckingZap || !newRecipientNpub || !canReceiveZaps || totalV4VPercentage === 0}
								data-testid="add-v4v-recipient-button"
							>
								Add
							</Button>
							<Button variant="outline" onClick={() => setShowAddForm(false)} data-testid="cancel-v4v-recipient-button">
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
						<Button
							variant="outline"
							onClick={() => setShowAddForm(true)}
							disabled={totalV4VPercentage === 0}
							data-testid="add-v4v-recipient-form-button"
						>
							+ V4V Recipient
						</Button>
						<Button
							variant="outline"
							onClick={handleEqualizeAll}
							disabled={localShares.length === 0 || totalV4VPercentage === 0}
							data-testid="equal-all-v4v-button"
						>
							<span className="i-sharing w-5 h-5 mr-2"></span>
							Equal All
						</Button>
					</div>
				)}

				{/* Save button */}
				{showSaveButton && (
					<div className="mt-6">
						{showCancelButton ? (
							<div className="flex gap-2">
								<Button variant="outline" onClick={onCancel} className="flex-1">
									Cancel
								</Button>
								<Button
									variant="focus"
									className="flex-1"
									onClick={handleSave}
									disabled={publishMutation.isPending || (showChangesIndicator && !hasChanges)}
									data-testid={saveButtonTestId}
								>
									{publishMutation.isPending
										? 'Saving...'
										: showChangesIndicator && hasChanges
											? saveButtonText
											: showChangesIndicator
												? 'Saved'
												: saveButtonText}
								</Button>
							</div>
						) : (
							<Button
								variant="focus"
								className="w-full"
								onClick={handleSave}
								disabled={publishMutation.isPending || (showChangesIndicator && !hasChanges)}
								data-testid={saveButtonTestId}
							>
								{publishMutation.isPending
									? 'Saving...'
									: showChangesIndicator && hasChanges
										? saveButtonText
										: showChangesIndicator
											? 'Saved'
											: saveButtonText}
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
