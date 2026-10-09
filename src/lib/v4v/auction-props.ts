import type { useAuctionV4VManager } from '@/hooks/useAuctionV4VManager'
import { auctionV4VConfig, auctionV4VLabels, type V4VConfig, type V4VLabels } from '@/lib/v4v/labels'

/**
 * Map the auction-settlement adapter hook output to the props expected by the
 * agnostic V4VManager component — the counterpart of `salesV4VManagerProps`.
 *
 * Same component, different declaration: basis points instead of per cent, no sales
 * banner or emoji, validators rendered as fixed rows, and a requirement that is about
 * an announced payout capability rather than zap capability. The component is told
 * none of that; it reads the labels, the config, and the unit.
 */
export function auctionV4VManagerProps(
	auction: ReturnType<typeof useAuctionV4VManager>,
	overrides: { labels?: Partial<V4VLabels>; config?: Partial<V4VConfig> } = {},
) {
	const config: V4VConfig = {
		...auctionV4VConfig,
		...overrides.config,
		recipientRequirement: {
			...auctionV4VConfig.recipientRequirement,
			...overrides.config?.recipientRequirement,
			checking: auction.recipientRequirementState.checking,
			satisfied: auction.recipientRequirementState.satisfied,
		},
	}

	return {
		shares: auction.shares,
		totalAllocated: auction.totalAllocated,
		newRecipientNpub: auction.newRecipientNpub,
		newRecipientAllocation: auction.newRecipientAllocation,
		showAddForm: auction.showAddForm,
		isChecking: false,
		isSaving: auction.isSaving,
		hasChanges: auction.hasChanges,
		showZapBadges: false,
		onTotalChange: auction.handleTotalChange,
		onProfileSelect: auction.handleProfileSelect,
		onAddRecipient: auction.handleAddRecipient,
		onRemoveRecipient: auction.handleRemoveRecipient,
		onUpdateAllocation: auction.handleUpdateAllocation,
		onEqualizeAll: auction.handleEqualizeAll,
		onSetNewRecipientAllocation: auction.handleSetNewRecipientAllocation,
		onToggleAddForm: auction.handleToggleAddForm,
		onSave: () => {
			void auction.handleSave()
		},
		labels: { ...auctionV4VLabels, ...overrides.labels },
		config,
	}
}
