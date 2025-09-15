import { Button, type buttonVariants } from '@/components/ui/button'
import { cartStore } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

interface CartButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

export function CartButton({ className, variant = 'primary', size = 'default', ...props }: CartButtonProps) {
	const { cart } = useStore(cartStore)

	const totalItems = Object.values(cart.products).reduce((total, product) => {
		return total + product.amount
	}, 0)

	const handleClick = () => {
		uiActions.openDrawer('cart')
	}

	return (
		<Button variant={variant} size={size} className={cn('p-2 relative', className)} onClick={handleClick} {...props}>
			<span className="i-basket w-6 h-6" />
			{totalItems > 0 && (
				<span className="absolute -top-1 -right-1 bg-secondary text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
					{totalItems > 99 ? '99+' : totalItems}
				</span>
			)}
		</Button>
	)
}
