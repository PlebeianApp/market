import { Button } from '@/components/ui/button'
import { SheetClose } from '@/components/ui/sheet'

export function EmptyCartScreen() {
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 text-center">
			<div>
				<h2 className="text-xl font-semibold mb-2">Your cart is empty</h2>
				<p className="text-gray-600">Looks like you haven't added any products to your cart yet.</p>
			</div>
			<div className="mt-8">
				<SheetClose asChild>
					<Button>Continue Shopping</Button>
				</SheetClose>
			</div>
		</div>
	)
} 