import type { useV4VManager } from '@/hooks/useV4VManager'
import type { V4VConfig, V4VLabels } from '@/lib/v4v/labels'
import { salesV4VConfig, salesV4VLabels } from '@/lib/v4v/labels'

/**
 * Map the sales / "all products" adapter hook output to the props expected by
 * the agnostic V4VManager component.
 *
 * Both call sites — the dashboard route (`circular-economy.tsx`) and the setup
 * dialog (`V4VSetupDialog.tsx`) — spread this helper and then override `labels`,
 * `config`, and (optionally) `onCancel`. Keeping the common prop mappings in one
 * place prevents the two consumers from drifting when `useV4VManager` adds or
 * renames a field.
 *
 * The zap requirement is the one prop that is part static copy and part live
 * state: the copy lives in `salesV4VConfig`, the answer comes from the hook. They
 * are composed here, so the component keeps reading a single
 * `recipientRequirement` without knowing what the requirement means.
 *
 * An auction adapter (`auctionV4VManagerProps`) follows the same pattern.
 */
export function salesV4VManagerProps(
	sales: ReturnType<typeof useV4VManager>,
	overrides: { labels?: Partial<V4VLabels>; config?: Partial<V4VConfig> } = {},
) {
	const config: V4VConfig = {
		...salesV4VConfig,
		...overrides.config,
		recipientRequirement: {
			...salesV4VConfig.recipientRequirement,
			...overrides.config?.recipientRequirement,
			checking: sales.isCheckingZap,
			satisfied: sales.canReceiveZaps,
		},
	}

	return {
		shares: sales.shares,
		totalAllocated: sales.totalAllocated,
		newRecipientNpub: sales.newRecipientNpub,
		newRecipientAllocation: sales.newRecipientAllocation,
		showAddForm: sales.showAddForm,
		isChecking: sales.isChecking,
		isSaving: sales.publishMutation.isPending,
		recipientColors: sales.recipientColors,
		emoji: sales.emoji,
		emojiSize: sales.emojiSize,
		emojiClass: sales.emojiClass,
		showZapBadges: true,
		onTotalChange: sales.handleTotalV4VPercentageChange,
		onProfileSelect: sales.handleProfileSelect,
		onAddRecipient: sales.handleAddRecipient,
		onRemoveRecipient: sales.handleRemoveRecipient,
		onUpdateAllocation: sales.handleUpdateAllocation,
		onEqualizeAll: sales.handleEqualizeAll,
		onSetNewRecipientAllocation: sales.setNewRecipientShare,
		onToggleAddForm: sales.setShowAddForm,
		onSave: () => {
			void sales.saveShares()
		},
		labels: { ...salesV4VLabels, ...overrides.labels },
		config,
	}
}
