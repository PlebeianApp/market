import { productFormActions } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import { hasProductFormDraft } from '@/lib/utils/productFormStorage'
import type { ProductFormTab } from '@/lib/stores/product'
import { useCallback, useEffect, useRef, useState } from 'react'

interface UseProductDraftOptions {
	productDTag: string | null | undefined
	productEventId: string | null | undefined
	editingProductId: string | null
	isDirty: boolean
	activeTab: ProductFormTab
}

/**
 * Manages draft persistence and the "Discard Edits" header action.
 *
 * Checks IndexedDB for a persisted draft on mount, tracks dirty state,
 * and wires the dashboard header "Discard Edits" button when editing.
 */
export function useProductDraft({ productDTag, productEventId, editingProductId, isDirty, activeTab }: UseProductDraftOptions) {
	const [hasDraft, setHasDraft] = useState(false)

	// Check for persisted draft on mount (for drafts from previous sessions)
	const checkForPersistedDraft = useCallback(async () => {
		const draftKey = productDTag || editingProductId
		if (draftKey) {
			const exists = await hasProductFormDraft(draftKey)
			if (exists) {
				setHasDraft(true)
			}
		}
	}, [productDTag, editingProductId])

	// Update hasDraft when isDirty changes (for immediate feedback on current session changes)
	useEffect(() => {
		if (editingProductId && isDirty) {
			setHasDraft(true)
		}
	}, [editingProductId, isDirty])

	// Store the discard function in a ref to avoid stale closures in the header action
	const discardEditsRef = useRef<(() => Promise<void>) | null>(null)

	// Update the ref whenever dependencies change
	useEffect(() => {
		discardEditsRef.current = async () => {
			const draftKey = productDTag || editingProductId
			if (!draftKey) return

			// Preserve current tab state before reset
			const currentActiveTab = activeTab

			await productFormActions.clearDraftForProduct(draftKey)

			// If we have a productEventId, reload the product from the network using the event ID
			// Pass the preserved tab state to avoid flicker
			if (productEventId && productDTag) {
				productFormActions.setEditingProductId(productDTag)
				await productFormActions.loadProductForEdit(productEventId, {
					preserveTabState: { activeTab: currentActiveTab },
				})
			} else {
				// No product to reload, just reset but restore tabs
				productFormActions.reset()
				productFormActions.setTabState(currentActiveTab)
			}

			setHasDraft(false)
			uiActions.clearDashboardHeaderAction()
		}
	}, [productDTag, editingProductId, productEventId, activeTab])

	// Stable callback that reads from the ref
	const handleDiscardEdits = useCallback(() => {
		discardEditsRef.current?.()
	}, [])

	// Check for persisted draft on mount
	useEffect(() => {
		checkForPersistedDraft()
	}, [checkForPersistedDraft])

	// Update dashboard header action when draft state changes
	useEffect(() => {
		if (editingProductId && hasDraft) {
			uiActions.setDashboardHeaderAction({
				label: 'Discard Edits',
				onClick: handleDiscardEdits,
			})
		} else {
			uiActions.clearDashboardHeaderAction()
		}

		// Clean up on unmount
		return () => {
			uiActions.clearDashboardHeaderAction()
		}
	}, [editingProductId, hasDraft, handleDiscardEdits])

	return { hasDraft }
}
