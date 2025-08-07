import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { getProductTitle, getProductImages, getProductId, productsByPubkeyQueryOptions } from '@/queries/products'
import { useDeleteProductMutation } from '@/publish/products'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { ChevronDown, PackageIcon, PlusIcon, Trash } from 'lucide-react'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { DashboardListItem } from '@/components/layout/DashboardListItem'

// Component to show basic product information
function ProductBasicInfo({ product }: { product: any }) {
	const description = product.content || 'No description'
	const images = getProductImages(product)
	const priceTag = product.tags.find((tag: any) => tag[0] === 'price')
	const price = priceTag ? `${priceTag[1]} ${priceTag[2]}` : 'Price not set'
	const statusTag = product.tags.find((tag: any) => tag[0] === 'status')
	const status = statusTag?.[1] || 'Unknown'

	return (
		<div className="p-4 bg-gray-50 border-t">
			<div className="space-y-3">
				{images.length > 0 && (
					<div className="w-full h-32 bg-gray-200 rounded-md overflow-hidden">
						<img src={images[0][1]} alt="Product image" className="w-full h-full object-cover" />
					</div>
				)}
				<div>
					<p className="text-sm text-gray-600 mb-1">Description:</p>
					<p className="text-sm">{description}</p>
				</div>
				<div className="flex justify-between">
					<div>
						<p className="text-sm text-gray-600">
							Price: <span className="font-medium">{price}</span>
						</p>
					</div>
					<div>
						<p className="text-sm text-gray-600">
							Status: <span className="font-medium capitalize">{status}</span>
						</p>
					</div>
				</div>
			</div>
		</div>
	)
}

function ProductListItem({
	product,
	isExpanded,
	onToggleExpanded,
	onEdit,
	onDelete,
	isDeleting,
}: {
	product: any
	isExpanded: boolean
	onToggleExpanded: () => void
	onEdit: () => void
	onDelete: () => void
	isDeleting: boolean
}) {
	const triggerContent = (
		<div>
			<p className="font-semibold">{getProductTitle(product)}</p>
		</div>
	)

	const actions = (
		<>
			<Button
				variant="ghost"
				size="sm"
				onClick={(e) => {
					e.stopPropagation()
					onEdit()
				}}
				aria-label={`Edit ${getProductTitle(product)}`}
			>
				<span className="i-edit w-5 h-5" />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={(e) => {
					e.stopPropagation()
					onDelete()
				}}
				aria-label={`Delete ${getProductTitle(product)}`}
				disabled={isDeleting}
			>
				{isDeleting ? (
					<div className="animate-spin h-4 w-4 border-2 border-destructive border-t-transparent rounded-full" />
				) : (
					<Trash className="w-4 h-4 text-destructive" />
				)}
			</Button>
		</>
	)

	return (
		<DashboardListItem
			isOpen={isExpanded}
			onOpenChange={onToggleExpanded}
			triggerContent={triggerContent}
			actions={actions}
			isDeleting={isDeleting}
			icon={<PackageIcon className="h-5 w-5 text-black" />}
		>
			<ProductBasicInfo product={product} />
		</DashboardListItem>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products')({
	component: ProductsOverviewComponent,
})

function ProductsOverviewComponent() {
	const { user, isAuthenticated } = useStore(authStore)
	const navigate = useNavigate()
	const matchRoute = useMatchRoute()
	const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
	useDashboardTitle('Products')
	// Check if we're on a child route (editing or creating a product)
	const isOnChildRoute =
		matchRoute({
			to: '/dashboard/products/products/$productId',
			fuzzy: true,
		}) ||
		matchRoute({
			to: '/dashboard/products/products/new',
			fuzzy: true,
		})

	const {
		data: products,
		isLoading,
		error,
	} = useQuery({
		...productsByPubkeyQueryOptions(user?.pubkey ?? ''),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	// Delete mutation
	const deleteMutation = useDeleteProductMutation()

	const handleAddProductClick = () => {
		productFormActions.reset()
		productFormActions.setEditingProductId(null)
		navigate({
			to: '/dashboard/products/products/new',
		})
	}

	const handleEditProductClick = (productId: string) => {
		navigate({
			to: '/dashboard/products/products/$productId',
			params: { productId },
		})
	}

	const handleToggleExpanded = (productId: string) => {
		setExpandedProduct(expandedProduct === productId ? null : productId)
	}

	const handleDeleteProductClick = async (product: any) => {
		if (confirm(`Are you sure you want to delete "${getProductTitle(product)}"?`)) {
			const productDTag = getProductId(product)
			if (productDTag) {
				deleteMutation.mutate(productDTag)
			}
		}
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your products.</p>
			</div>
		)
	}

	// If we're on a child route, render the child route
	if (isOnChildRoute) {
		return <Outlet />
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Products</h1>
				<Button
					onClick={handleAddProductClick}
					data-testid="add-product-button"
					className="btn-black flex items-center gap-2 px-4 py-2 text-sm font-semibold"
				>
					<span className="i-product w-5 h-5" /> Add A Product
				</Button>
			</div>
			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden">
					<Button
						onClick={handleAddProductClick}
						data-testid="add-product-button-mobile"
						className="w-full btn-black flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<span className="i-product w-5 h-5" /> Add A Product
					</Button>
				</div>

				<div>
					{isLoading && <div className="p-6 text-center text-gray-500 mt-4">Loading your products...</div>}
					{error && <div className="p-6 text-center text-red-600 mt-4">Failed to load products: {error.message}</div>}

					{!isLoading && !error && (
						<>
							{products && products.length > 0 ? (
								<ul className="flex flex-col gap-4">
									{products.map((product) => (
										<li key={product.id}>
											<ProductListItem
												product={product}
												isExpanded={expandedProduct === product.id}
												onToggleExpanded={() => handleToggleExpanded(product.id)}
												onEdit={() => handleEditProductClick(product.id)}
												onDelete={() => handleDeleteProductClick(product)}
												isDeleting={deleteMutation.isPending && deleteMutation.variables === getProductId(product)}
											/>
										</li>
									))}
								</ul>
							) : (
								<div className="text-center text-gray-500 py-10 px-6">
									<span className="i-product w-5 h-5" />
									<h3 className="mt-2 text-lg font-semibold text-gray-700">No products yet</h3>
									<p className="mt-1 text-sm">Click the "Add A Product" button to create your first one.</p>
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	)
}
