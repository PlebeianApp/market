import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cartStore } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'

export function CartButton() {
	const { cart } = useStore(cartStore)

	const totalItems = Object.values(cart.products).reduce((total, product) => {
		return total + product.amount
	}, 0)

	const handleClick = () => {
		uiActions.openDrawer('cart')
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="primary" className="p-2 relative hover:[&>span]:text-secondary" onClick={handleClick} data-testid="cart-button">
					<span className="i-basket w-6 h-6" />
					{totalItems > 0 && (
						<span
							className="absolute -top-1 -right-1 bg-secondary text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center"
							data-testid="cart-item-count"
						>
							{totalItems > 99 ? '99+' : totalItems}
						</span>
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">View cart</TooltipContent>
		</Tooltip>
	)
}
