import CartSheetContent from '@/components/sheet-contents/CartSheetContent'
import { NewProductContent } from '@/components/sheet-contents/NewProductContent'
import { NewCollectionContent } from '@/components/sheet-contents/NewCollectionContent'
import { Sheet } from '@/components/ui/sheet'
import { useStore } from '@tanstack/react-store'
import { uiStore } from '@/lib/stores/ui'
import { useMemo } from 'react'

export function SheetRegistry() {
	const { drawers } = useStore(uiStore)

	const activeDrawer = useMemo(() => {
		if (drawers.cart) return 'cart'
		if (drawers.createProduct) return 'createProduct'
		if (drawers.createCollection) return 'createCollection'
		return null
	}, [drawers])

	if (!activeDrawer) return null

	const sheetConfig = {
		cart: {
			side: 'right' as const,
			content: <CartSheetContent title="Your Cart" description="Review and manage your cart items" />,
		},
		createProduct: {
			side: 'right' as const,
			content: <NewProductContent title="Add A Product" description="Create a new product to sell in your shop" />,
		},
		createCollection: {
			side: 'right' as const,
			content: <NewCollectionContent title="Create Collection" description="Organize your products into collections" />,
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
