import CartSheetContent from '@/components/sheet-contents/CartSheetContent'
import { NewProductContent } from '@/components/sheet-contents/NewProductContent'
import { NewCollectionContent } from '@/components/sheet-contents/NewCollectionContent'
import { Sheet } from '@/components/ui/sheet'
import { useStore } from '@tanstack/react-store'
import { uiStore } from '@/lib/stores/ui'
import { useMemo, useState, useEffect } from 'react'

export function SheetRegistry() {
	const { drawers } = useStore(uiStore)
	const [isClosing, setIsClosing] = useState(false)
	const [closingDrawer, setClosingDrawer] = useState<string | null>(null)

	const activeDrawer = useMemo(() => {
		if (drawers.cart) return 'cart'
		if (drawers.createProduct) return 'createProduct'
		if (drawers.createCollection) return 'createCollection'
		return null
	}, [drawers])

	// Handle animation completion
	useEffect(() => {
		if (isClosing && closingDrawer) {
			const timer = setTimeout(() => {
				setIsClosing(false)
				setClosingDrawer(null)
			}, 700) // Match the animation duration

			return () => clearTimeout(timer)
		}
	}, [isClosing, closingDrawer])

	// Don't render if no drawer is active and we're not in the middle of closing
	if (!activeDrawer && !isClosing) return null

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

	const currentDrawer = activeDrawer || closingDrawer || 'cart'
	const config = sheetConfig[currentDrawer as keyof typeof sheetConfig]

	return (
		<Sheet
			open={!!activeDrawer}
			onOpenChange={(open) => {
				if (!open) {
					// Start closing animation
					setIsClosing(true)
					setClosingDrawer(activeDrawer)

					// Close the active drawer after animation completes
					setTimeout(() => {
						if (activeDrawer) {
							uiStore.setState((state) => ({
								...state,
								drawers: {
									...state.drawers,
									[activeDrawer]: false,
								},
							}))
						}
					}, 700) // Match the animation duration
				}
			}}
		>
			{config.content}
		</Sheet>
	)
}
