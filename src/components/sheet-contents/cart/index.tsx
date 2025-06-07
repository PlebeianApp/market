import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
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
	const isCartEmpty = Object.keys(cart.products).length === 0

	if (isCartEmpty) {
		return (
			<SheetContent side="right">
				<SheetHeader>
					<SheetTitle>Your cart is empty</SheetTitle>
					<SheetDescription>Looks like you haven't added any products to your cart yet.</SheetDescription>
				</SheetHeader>
				<EmptyCartScreen />
			</SheetContent>
		)
	}

	return (
		<SheetContent
			side="right"
			className="flex flex-col max-h-screen overflow-hidden w-[100vw] sm:min-w-[85vw] md:min-w-[55vw] xl:min-w-[35vw]"
		>
			<SheetHeader>
				<SheetTitle>{title}</SheetTitle>
				<SheetDescription className="hidden">{description}</SheetDescription>
			</SheetHeader>
			<CartContent />
		</SheetContent>
	)
}

// Export the content components as well for reuse
export { CartContent } from './CartContent'
export { EmptyCartScreen } from './EmptyCartScreen'
