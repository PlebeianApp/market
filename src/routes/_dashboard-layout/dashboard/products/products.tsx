import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { useDeleteProductMutation } from '@/publish/products'
import { getProductId, getProductImages, getProductTitle, productsByPubkeyQueryOptions } from '@/queries/products'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { PackageIcon, Trash, EyeOff, Clock, Eye, AlertTriangle } from 'lucide-react'
import { useState } from 'react'

// Component to show basic product information
function ProductBasicInfo({ product }: { product: any }) {
	const description = product.content || 'No description'
	const images = getProductImages(product)
	const priceTag = product.tags.find((tag: any) => tag[0] === 'price')
	const price = priceTag ? `${priceTag[1]} ${priceTag[2]}` : 'Price not set'
	const visibilityTag = product.tags.find((tag: any) => tag[0] === 'visibility')
	const visibility = visibilityTag?.[1] || 'on-sale'
	const stockTag = product.tags.find((tag: any) => tag[0] === 'stock')
	const stock = stockTag?.[1]

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
							Visibility:{' '}
							<span
								className={`font-medium capitalize ${visibility === 'hidden' ? 'text-gray-500' : visibility === 'pre-order' ? 'text-blue-600' : 'text-green-600'}`}
							>
								{visibility}
							</span>
						</p>
					</div>
				</div>
				{stock && (
					<div>
						<p className="text-sm text-gray-600">
							Stock: <span className="font-medium">{stock} in stock</span>
						</p>
					</div>
				)}
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
	const visibilityTag = product.tags.find((tag: any) => tag[0] === 'visibility')
	const visibility = visibilityTag?.[1] || 'on-sale'

	const getVisibilityIcon = () => {
		switch (visibility) {
			case 'hidden':
				return <EyeOff className="w-4 h-4 text-gray-500" />
			case 'pre-order':
				return <Clock className="w-4 h-4 text-blue-600" />
			case 'on-sale':
				return <Eye className="w-4 h-4 text-green-600" />
			default:
				return null
		}
	}

	const triggerContent = (
		<div className="flex items-center gap-2">
			{getVisibilityIcon()}
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

	// Fetch user profile to check for lightning address
	const { data: profileData } = useQuery({
		...profileByIdentifierQueryOptions(user?.pubkey ?? ''),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	// Check if user has lightning address
	const hasLightningAddress = profileData?.profile?.lud16 || profileData?.profile?.lud06

	// Handler to navigate to profile section
	const handleNavigateToProfile = () => {
		navigate({
			to: '/dashboard/account/profile',
		})
	}

	// Auto-animate for smooth list transitions
	const [animationParent] = (() => {
		try {
			return useAutoAnimate()
		} catch (error) {
			console.warn('Auto-animate not available:', error)
			return [null]
		}
	})()
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
		...productsByPubkeyQueryOptions(user?.pubkey ?? '', true), // Include hidden products for own dashboard
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
					disabled={!hasLightningAddress}
					className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
				>
					<span className="i-product w-5 h-5" /> Add A Product
				</Button>
			</div>

			{/* Lightning address warning snackbar */}
			{!hasLightningAddress && (
				<div className="px-4 lg:px-6 py-3 bg-white border-b">
					<Alert
						className="bg-orange-50 border-orange-200 text-orange-800 cursor-pointer hover:bg-orange-100 transition-colors"
						onClick={handleNavigateToProfile}
					>
						<AlertTriangle className="h-4 w-4" />
						<AlertDescription>
							<p>A Lightning address is required</p>
							<br />
							<p>Click here to edit your profile and add your Lightning Address (LUD16)</p>
						</AlertDescription>
					</Alert>
				</div>
			)}
			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden">
					<Button
						onClick={handleAddProductClick}
						data-testid="add-product-button-mobile"
						disabled={!hasLightningAddress}
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
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
								<ul ref={animationParent} className="flex flex-col gap-4 mt-4">
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
