import { Media } from '@/components/Media'
import { authStore } from '@/lib/stores/auth'
import { collectionFormStore, collectionFormActions } from '@/lib/stores/collection'
import { useProductsByPubkey } from '@/queries/products'
import { getProductCoordinates, getProductId, getProductTitle, getProductImages } from '@sdk/commerce/discovery'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'
import { ProductSelectionList } from '@ui/components/ProductSelectionList'

export function ProductsTab() {
	const { selectedProducts, availableProducts } = useStore(collectionFormStore)
	const { user } = useStore(authStore)

	// Fetch user's products (including hidden ones for collection management)
	const { data: products = [], isLoading } = useProductsByPubkey(user?.pubkey || '', true)

	// Update available products when products are loaded
	// TODO: Refactor this to use the new product query
	useEffect(() => {
		if (products.length > 0) {
			const productData = products.map((product) => {
				const id = getProductId(product)
				const title = getProductTitle(product)
				const images = getProductImages(product)
				const coordinates = getProductCoordinates(product)

				return {
					id,
					title,
					coordinates,
					imageUrl: images[0]?.[1], // First image URL
				}
			})

			collectionFormActions.setAvailableProducts(productData)
		}
	}, [products])

	const handleProductToggle = (productCoordinates: string, isChecked: boolean) => {
		if (isChecked) {
			collectionFormActions.addProduct(productCoordinates)
		} else {
			collectionFormActions.removeProduct(productCoordinates)
		}
	}

	return (
		<ProductSelectionList
			items={availableProducts}
			selectedCoordinates={selectedProducts}
			isLoading={isLoading}
			onToggle={handleProductToggle}
			renderImage={(url, title) => <Media src={url} alt={title} className="size-10 rounded object-cover" />}
		/>
	)
}
