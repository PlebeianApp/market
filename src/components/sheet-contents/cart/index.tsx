import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cartStore } from '@/lib/stores/cart'
import { uiStore, uiActions } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import { useEffect, useState } from 'react'
import { CartContent } from './CartContent'
import { EmptyCartScreen } from './EmptyCartScreen'

export default function CartSheetContent({
	title = 'YOUR CART',
	description = 'Review and manage your cart items',
}: {
	title?: string
	description?: string
}) {
	const { cart } = useStore(cartStore)
	const { drawers } = useStore(uiStore)
	const isCartEmpty = Object.keys(cart.products).length === 0
	const [open, setOpen] = useState(drawers.cart)

	useEffect(() => {
		setOpen(drawers.cart)
	}, [drawers.cart])

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen)
		if (!nextOpen) {
			// Delay closing in store until after animation
			setTimeout(() => {
				uiActions.closeDrawer('cart')
			}, 300) // matches slide-out duration
		}
	}

	if (isCartEmpty) {
		return (
			<Sheet open={open} onOpenChange={handleOpenChange}>
				<SheetContent side="right" className="flex flex-col max-h-screen w-[100vw] sm:w-[85vw] md:w-[55vw] xl:w-[35vw]">
					<EmptyCartScreen />
				</SheetContent>
			</Sheet>
		)
	}

	return (
		<Sheet open={open} onOpenChange={handleOpenChange}>
			<SheetContent side="right" className="flex flex-col max-h-screen w-[100vw] sm:w-[85vw] md:w-[55vw] xl:w-[35vw]">
				<SheetHeader>
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription className="hidden">{description}</SheetDescription>
				</SheetHeader>
				<CartContent />
			</SheetContent>
		</Sheet>
	)
}

// Export the content components as well for reuse
export { CartContent } from './CartContent'
export { EmptyCartScreen } from './EmptyCartScreen'
