import CartSheetContent from '@/components/sheet-contents/CartSheetContent'
import { NewProductContent } from '@/components/sheet-contents/NewProductContent'
import { NewCollectionContent } from '@/components/sheet-contents/NewCollectionContent'
import { ConversationSheetContent } from '@/components/sheet-contents/ConversationSheetContent'
import { Sheet } from '@/components/ui/sheet'
import { useStore } from '@tanstack/react-store'
import { uiStore } from '@/lib/stores/ui'
import { useMemo, useState, useEffect } from 'react'

export function SheetRegistry() {
	const { drawers, conversationPubkey } = useStore(uiStore)

	const activeDrawer = useMemo(() => {
		if (drawers.cart) return 'cart'
		if (drawers.createProduct) return 'createProduct'
		if (drawers.createCollection) return 'createCollection'
		if (drawers.conversation) return 'conversation'
		return null
	}, [drawers])

	// Local state to control sheet open/close for animations
	const [open, setOpen] = useState(!!activeDrawer)

	// Sync local state with store state
	useEffect(() => {
		setOpen(!!activeDrawer)
	}, [activeDrawer])

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen)
		if (!nextOpen && activeDrawer) {
			// Delay closing in store until after animation (300ms slide-out duration)
			setTimeout(() => {
				uiStore.setState((state) => ({
					...state,
					drawers: {
						...state.drawers,
						[activeDrawer]: false,
					},
				}))
			}, 300)
		}
	}

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
		conversation: {
			side: 'right' as const,
			content: conversationPubkey ? <ConversationSheetContent pubkey={conversationPubkey} /> : null,
		},
	}

	const config = sheetConfig[activeDrawer]

	return (
		<Sheet open={open} onOpenChange={handleOpenChange}>
			{config.content}
		</Sheet>
	)
}
