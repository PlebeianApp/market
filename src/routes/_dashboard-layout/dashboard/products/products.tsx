import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import { getProductTitle, productsByPubkeyQueryOptions } from '@/queries/products'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'

// Placeholder icon components - replace with your actual icon library
const CubeIcon = () => <span className="i-product w-5 h-5" />
const PencilIcon = () => <span className="i-edit w-5 h-5" />

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products')({
	component: ProductsOverviewComponent,
})

function ProductsOverviewComponent() {
	const { user, isAuthenticated } = useStore(authStore)

	const {
		data: products,
		isLoading,
		error,
	} = useQuery({
		...productsByPubkeyQueryOptions(user?.pubkey ?? ''),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	const handleAddProductClick = () => {
		productFormActions.reset()
		productFormActions.setEditingProductId(null)
		uiActions.openDrawer('createProduct')
	}

	const handleEditProductClick = async (productId: string) => {
		productFormActions.reset()
		productFormActions.setEditingProductId(productId)
		await productFormActions.loadProductForEdit(productId)
		uiActions.openDrawer('createProduct')
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your products.</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<div className="bg-white rounded-md shadow-sm">
				<Button
					onClick={handleAddProductClick}
					className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
				>
					<CubeIcon />
					Add A Product
				</Button>

				{isLoading && <div className="p-6 text-center text-gray-500">Loading your products...</div>}
				{error && <div className="p-6 text-center text-red-600">Failed to load products: {error.message}</div>}

				{!isLoading && !error && (
					<>
						{products && products.length > 0 ? (
							<ul className="p-4 flex flex-col gap-2">
								{products.map((product) => (
									<li
										key={product.id}
										className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors duration-150 border border-gray-300 rounded-md"
									>
										<div className="flex items-center gap-3">
											<CubeIcon />
											<span className="text-sm font-medium text-gray-800">{getProductTitle(product)}</span>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleEditProductClick(product.id)}
											aria-label={`Edit ${getProductTitle(product)}`}
											className="text-gray-500 hover:text-gray-700"
										>
											<PencilIcon />
										</Button>
									</li>
								))}
							</ul>
						) : (
							<div className="text-center text-gray-500 py-10 px-6">
								<CubeIcon />
								<h3 className="mt-2 text-lg font-semibold text-gray-700">No products yet</h3>
								<p className="mt-1 text-sm">Click the "Add A Product" button to create your first one.</p>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}
