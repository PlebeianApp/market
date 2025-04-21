import { Button } from '@/components/ui/button'
import { DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useCart } from '@/lib/stores/cart'
import { Minus, Plus, Trash2 } from 'lucide-react'

export default function CartDrawerContent() {
	const { cart, handleProductUpdate } = useCart()

	// Calculate total items
	const totalItems = Object.values(cart.products).reduce((total, product) => {
		return total + product.amount
	}, 0)

	// Group amounts by currency
	const amountsByCurrency = Object.values(cart.products).reduce(
		(acc, product) => {
			const currency = product.currency
			if (!acc[currency]) {
				acc[currency] = 0
			}
			acc[currency] += product.price * product.amount
			return acc
		},
		{} as Record<string, number>,
	)

	// Get user pubkey (assuming there's only one user)
	const userPubkey = Object.keys(cart.users)[0]

	if (Object.keys(cart.products).length === 0) {
		return (
			<DrawerContent>
				<div className="flex flex-col items-center justify-center h-full p-8 text-center">
					<DrawerHeader>
						<DrawerTitle>Your cart is empty</DrawerTitle>
						<DrawerDescription>Looks like you haven't added any products to your cart yet.</DrawerDescription>
					</DrawerHeader>
					<DrawerFooter>
						<DrawerClose asChild>
							<Button>Continue Shopping</Button>
						</DrawerClose>
					</DrawerFooter>
				</div>
			</DrawerContent>
		)
	}

	return (
		<DrawerContent>
			{/* Cart Items - Scrollable Area */}
			<div className="flex-1 overflow-y-auto py-4 px-6">
				<ul className="space-y-6">
					{Object.values(cart.products).map((product) => (
						<li key={product.id} className="flex gap-4 pb-4 border-b">
							{/* Product Image */}
							{product.images && product.images.length > 0 && (
								<div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border">
									<img
										src={product.images[0].url}
										alt={product.images[0].alt || product.name}
										className="h-full w-full object-cover object-center"
									/>
								</div>
							)}

							{/* Product Details */}
							<div className="flex flex-1 flex-col justify-between">
								<div>
									<h3 className="text-base font-medium">{product.name}</h3>
									<p className="mt-1 text-sm text-muted-foreground">
										{product.price} {product.currency}
									</p>
								</div>

								{/* Quantity Controls */}
								<div className="flex items-center justify-between mt-2">
									<div className="flex items-center space-x-2">
										<Button
											variant="outline"
											size="icon"
											className="h-8 w-8"
											onClick={() => userPubkey && handleProductUpdate('decrement', userPubkey, product.id)}
											disabled={product.amount <= 1}
										>
											<Minus size={14} />
										</Button>
										<span className="w-8 text-center">{product.amount}</span>
										<Button
											variant="outline"
											size="icon"
											className="h-8 w-8"
											onClick={() => userPubkey && handleProductUpdate('increment', userPubkey, product.id)}
											disabled={product.amount >= product.stockQuantity}
										>
											<Plus size={14} />
										</Button>
									</div>

									{/* Delete Button */}
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
										onClick={() => userPubkey && handleProductUpdate('remove', userPubkey, product.id)}
									>
										<Trash2 size={16} />
									</Button>
								</div>
							</div>

							{/* Product Total */}
							<div className="flex items-center">
								<p className="text-sm font-medium">
									{(product.price * product.amount).toFixed(2)} {product.currency}
								</p>
							</div>
						</li>
					))}
				</ul>
			</div>

			{/* Cart Footer */}
			<DrawerFooter className="border-t p-6 bg-gray-50">
				<div className="space-y-4">
					{/* Subtotal per currency */}
					<div className="space-y-2">
						{Object.entries(amountsByCurrency).map(([currency, amount]) => (
							<div key={currency} className="flex justify-between">
								<p className="text-sm text-muted-foreground">Subtotal ({currency})</p>
								<p className="text-sm font-medium">
									{amount.toFixed(2)} {currency}
								</p>
							</div>
						))}
					</div>

					<div className="text-xs text-muted-foreground">Shipping and taxes calculated at checkout</div>

					{/* Action Buttons */}
					<div className="space-y-2">
						<Button className="w-full" size="lg">
							Checkout ({totalItems} {totalItems === 1 ? 'item' : 'items'})
						</Button>
						<DrawerClose asChild>
							<Button variant="outline" className="w-full">
								Continue Shopping
							</Button>
						</DrawerClose>
					</div>
				</div>
			</DrawerFooter>
		</DrawerContent>
	)
}
