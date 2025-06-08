import { ProductFormContent } from '@/components/sheet-contents/NewProductContent'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { productsByPubkeyQueryOptions } from '@/queries/products'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products/$productId')({
	component: EditProductComponent,
})

function EditProductComponent() {
	const { productId } = Route.useParams()
	const { user } = useStore(authStore)

	useDashboardTitle('Edit Product')

	// Fetch user's products to find the one being edited
	const { data: products = [] } = useQuery({
		...productsByPubkeyQueryOptions(user?.pubkey ?? ''),
		enabled: !!user?.pubkey,
	})

	// Find the product being edited
	const product = products.find((p) => p.id === productId)

	useEffect(() => {
		if (product) {
			// Set editing mode and load product data
			productFormActions.reset()
			productFormActions.setEditingProductId(productId)
			productFormActions.loadProductForEdit(productId)
		}
	}, [product, productId])

	if (!product) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Product Not Found</h1>
				<p className="text-gray-600">The product you're looking for doesn't exist or you don't have access to it.</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<div className="bg-white rounded-md shadow-sm">
				<ProductFormContent showFooter={true} />
			</div>
		</div>
	)
}
