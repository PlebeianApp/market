import type { useV4VManager } from '@/hooks/useV4VManager'

/**
 * Map the sales / "all products" adapter hook output to the props expected by
 * the agnostic V4VManager component.
 *
 * Both call sites — the dashboard route (`circular-economy.tsx`) and the setup
 * dialog (`V4VSetupDialog.tsx`) — spread this helper and then add their own
 * `labels`, `config`, and (optionally) `onCancel`. Keeping the ~25 common prop
 * mappings in one place prevents the two consumers from drifting when
 * `useV4VManager` adds or renames a field.
 *
 * A future auction adapter would have its own `auctionV4VManagerProps()`
 * helper following the same pattern.
 */
export function salesV4VManagerProps(sales: ReturnType<typeof useV4VManager>) {
	return {
		shares: sales.localShares,
		totalV4VPercentage: sales.totalV4VPercentage,
		newRecipientNpub: sales.newRecipientNpub,
		newRecipientShare: sales.newRecipientShare,
		showAddForm: sales.showAddForm,
		canReceiveZaps: sales.canReceiveZaps,
		isCheckingZap: sales.isCheckingZap,
		isChecking: sales.isChecking,
		isSaving: sales.publishMutation.isPending,
		sellerPercentage: sales.sellerPercentage,
		formattedSellerPercentage: sales.formattedSellerPercentage,
		formattedTotalV4V: sales.formattedTotalV4V,
		recipientColors: sales.recipientColors,
		emoji: sales.emoji,
		emojiSize: sales.emojiSize,
		emojiClass: sales.emojiClass,
		onTotalV4VPercentageChange: sales.handleTotalV4VPercentageChange,
		onProfileSelect: sales.handleProfileSelect,
		onAddRecipient: sales.handleAddRecipient,
		onRemoveRecipient: sales.handleRemoveRecipient,
		onUpdatePercentage: sales.handleUpdatePercentage,
		onEqualizeAll: sales.handleEqualizeAll,
		onSetNewRecipientShare: sales.setNewRecipientShare,
		onToggleAddForm: sales.setShowAddForm,
		onSave: () => {
			void sales.saveShares()
		},
	}
}
