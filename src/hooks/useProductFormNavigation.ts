import { productFormActions, type ProductFormTab } from '@/lib/stores/product'
import { isShippingDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useEffect, useMemo, useRef } from 'react'

interface UseProductFormNavigationOptions {
	userPubkey: string
	editingProductId: string | null
	activeTab: ProductFormTab
	formSessionId: number
	hasValidShipping: boolean
}

/**
 * Manages automatic tab navigation for the product form.
 *
 * When a new user has no shipping options:
 * 1. Auto-switches to shipping tab on form open
 * 2. After first shipping option is added, auto-navigates to name tab
 *
 * Returns whether shipping should be shown first (for conditional UI).
 */
export function useProductFormNavigation({
	userPubkey,
	editingProductId,
	activeTab,
	formSessionId,
	hasValidShipping,
}: UseProductFormNavigationOptions) {
	const {
		data: userShippingOptions,
		isLoading: isLoadingUserShipping,
		isFetched: isShippingFetched,
	} = useShippingOptionsByPubkey(userPubkey)

	const shouldShowShippingFirst = useMemo(() => {
		if (editingProductId) return false
		if (!userPubkey) return false
		if (!isShippingFetched) return false
		if (isLoadingUserShipping) return false
		if (!userShippingOptions || userShippingOptions.length === 0) return true
		const activeShippingOptions = userShippingOptions.filter((event) => {
			const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1]
			return dTag ? !isShippingDeleted(dTag) : true
		})
		return activeShippingOptions.length === 0
	}, [editingProductId, userShippingOptions, isLoadingUserShipping, userPubkey, isShippingFetched])

	// Track which formSessionId we've handled to avoid re-triggering
	const handledSessionIdRef = useRef<number | null>(null)
	// Track if we started with shipping first
	const startedWithShippingFirstRef = useRef<boolean>(false)

	// Auto-switch to shipping tab when user has no shipping options
	useEffect(() => {
		if (handledSessionIdRef.current !== formSessionId && shouldShowShippingFirst && activeTab !== 'shipping') {
			productFormActions.updateValues({ activeTab: 'shipping' })
			handledSessionIdRef.current = formSessionId
		}
	}, [shouldShowShippingFirst, activeTab, formSessionId])

	// Track if we started on shipping tab
	useEffect(() => {
		if (shouldShowShippingFirst && activeTab === 'shipping') {
			startedWithShippingFirstRef.current = true
		}
	}, [shouldShowShippingFirst, activeTab])

	// Auto-navigate to name tab after first shipping option is added
	useEffect(() => {
		if (startedWithShippingFirstRef.current && hasValidShipping && activeTab === 'shipping') {
			productFormActions.updateValues({ activeTab: 'name' })
			startedWithShippingFirstRef.current = false
		}
	}, [hasValidShipping, activeTab])

	return { shouldShowShippingFirst }
}
