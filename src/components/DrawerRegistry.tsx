import CartDrawerContent from '@/components/drawer-contents/CartDrawerContent'
import { Drawer, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { useStore } from '@tanstack/react-store'
import { uiStore } from '@/lib/stores/ui'
import { useMemo } from 'react'

export function DrawerRegistry() {
	const { drawers } = useStore(uiStore)

	const activeDrawer = useMemo(() => {
		if (drawers.cart) return 'cart'
		if (drawers.createProduct) return 'createProduct'
		return null
	}, [drawers])

	if (!activeDrawer) return null

	const drawerConfig = {
		cart: {
			title: 'Your Cart',
			description: 'Review your items',
			side: 'right' as const,
			content: <CartDrawerContent />,
		},
		createProduct: {
			title: 'Create Product',
			description: 'Create a new product',
			side: 'right' as const,
			content: (
				<>
					<DrawerHeader>
						<DrawerTitle>Filter Products</DrawerTitle>
						<DrawerDescription>Narrow your search</DrawerDescription>
					</DrawerHeader>
					<div className="p-6">Filter content goes here</div>
				</>
			),
		},
	}

	const config = drawerConfig[activeDrawer]

	return (
		<Drawer type={activeDrawer} side={config.side}>
			{config.content}
		</Drawer>
	)
}
