import { Checkbox } from '@/components/ui/checkbox'
import { LazyImage } from '@/components/ui/lazy-image'
import { authStore } from '@/lib/stores/auth'
import { collectionFormStore, collectionFormActions } from '@/lib/stores/collection'
import { useProductsByPubkey } from '@/queries/products'
import { getProductId, getProductTitle, getProductImages } from '@/queries/products'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

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
				const coordinates = `30402:${product.pubkey}:${id}`

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

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-32">
				<div className="text-gray-500">Loading your products...</div>
			</div>
		)
	}

	if (availableProducts.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-32 space-y-2">
				<div className="text-gray-500">No products found</div>
				<div className="text-sm text-gray-400">Create some products first to add them to collections</div>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<p className="text-gray-600">Select products to include in this collection</p>

			<div className="space-y-3">
				{availableProducts.map((product) => {
					const isSelected = selectedProducts.includes(product.coordinates)

					return (
						<div key={product.coordinates} className="flex items-center space-x-3 p-3 border rounded-lg">
							<Checkbox
								id={product.coordinates}
								checked={isSelected}
								onCheckedChange={(checked) => handleProductToggle(product.coordinates, !!checked)}
							/>

							<div className="flex items-center space-x-3 flex-1">
								{product.imageUrl && (
									<LazyImage
										src={product.imageUrl}
										alt={product.title}
										className="object-cover rounded"
										containerClassName="w-10 h-10"
										aspectRatio=""
										lazy={false}
									/>
								)}
								<div className="flex-1">
									<label htmlFor={product.coordinates} className="text-sm font-medium cursor-pointer">
										{product.title}
									</label>
								</div>
							</div>
						</div>
					)
				})}
			</div>

			{selectedProducts.length > 0 && (
				<div className="text-sm text-gray-600 mt-4">
					{selectedProducts.length} product{selectedProducts.length !== 1 ? 's' : ''} selected
				</div>
			)}
		</div>
	)
}
