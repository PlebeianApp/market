import CartSheetContent from '@/components/sheet-contents/CartSheetContent'
import { Sheet } from '@/components/ui/sheet'
import { useStore } from '@tanstack/react-store'
import { uiStore } from '@/lib/stores/ui'
import { useMemo } from 'react'

export function SheetRegistry() {
	const { drawers } = useStore(uiStore)

	const activeDrawer = useMemo(() => {
		if (drawers.cart) return 'cart'
		if (drawers.createProduct) return 'createProduct'
		return null
	}, [drawers])

	if (!activeDrawer) return null

	const sheetConfig = {
		cart: {
			side: 'right' as const,
			content: <CartSheetContent />,
		},
		createProduct: {
			side: 'right' as const,
			content: <>{/* Content will be refactored separately */}</>,
		},
	}

	const config = sheetConfig[activeDrawer]

	return (
		<Sheet
			open={!!activeDrawer}
			onOpenChange={(open) => {
				if (!open) {
					// Close the active drawer
					uiStore.setState((state) => ({
						...state,
						drawers: {
							...state.drawers,
							[activeDrawer]: false,
						},
					}))
				}
			}}
		>
			{config.content}
		</Sheet>
	)
}
