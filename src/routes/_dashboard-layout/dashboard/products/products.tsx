import { ShareProductDialog } from '@/components/dialogs/ShareProductDialog'
import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { Button } from '@/components/ui/button'
import { LazyImage } from '@/components/ui/lazy-image'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { useDeleteProductMutation } from '@/publish/products'
import {
	getProductId,
	getProductImages,
	getProductPrice,
	getProductTitle,
	productQueryOptions,
	productsByPubkeyQueryOptions,
} from '@/queries/products'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { PackageIcon, Trash, EyeOff, Clock, Eye } from 'lucide-react'
import { useState, useMemo } from 'react'

// Component to show basic product information
function ProductBasicInfo({ product }: { product: NDKEvent }) {
	const description = product.content || 'No description'
	const images = getProductImages(product)
	const priceTag = getProductPrice(product)
	const price = priceTag ? `${priceTag[1]} ${priceTag[2]}` : 'Price not set'
	const visibilityTag = product.tags.find((tag) => tag[0] === 'visibility')
	const visibility = visibilityTag?.[1] || 'on-sale'
	const stockTag = product.tags.find((tag) => tag[0] === 'stock')
	const stock = stockTag?.[1]
	const queryClient = useQueryClient()

	return (
		<Link
			to={`/products/${product.id}`}
			onClick={() => queryClient.setQueryData(productQueryOptions(product.id).queryKey, product)}
			className="block p-4 bg-gray-50 border-t hover:bg-gray-100 transition-colors cursor-pointer"
		>
			<div className="space-y-3">
				{images.length > 0 && (
					<div className="w-full h-32 bg-gray-200 rounded-md overflow-hidden">
						<LazyImage src={images[0][1]} alt="Product image" containerClassName="w-full h-full" aspectRatio="" />
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
				<p className="text-xs text-gray-400 text-right">Click to view product page →</p>
			</div>
		</Link>
	)
}

function ProductListItem({
	product,
	isExpanded,
	onToggleExpanded,
	onEdit,
	onShare,
	onDelete,
	isDeleting,
}: {
	product: NDKEvent
	isExpanded: boolean
	onToggleExpanded: () => void
	onEdit: () => void
	onShare: () => void
	onDelete: () => void
	isDeleting: boolean
}) {
	const visibilityTag = product.tags.find((tag) => tag[0] === 'visibility')
	const visibility = visibilityTag?.[1] || 'on-sale'
	const images = getProductImages(product)
	const thumbnailUrl = images.length > 0 ? images[0][1] : null

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
		<div className="flex items-center gap-3">
			{thumbnailUrl ? (
				<LazyImage src={thumbnailUrl} alt="" className="rounded" containerClassName="w-10 h-10 shrink-0" aspectRatio="" />
			) : (
				<div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0">
					<PackageIcon className="w-5 h-5 text-gray-400" />
				</div>
			)}
			<div className="flex items-center gap-2 min-w-0">
				{getVisibilityIcon()}
				<p className="font-semibold truncate">{getProductTitle(product)}</p>
			</div>
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
					onShare()
				}}
				aria-label={`Share ${getProductTitle(product)}`}
			>
				<span className="i-sharing w-4 h-4" />
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
			icon={false}
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
	const [orderBy, setOrderBy] = useState<string>('newest')
	const [shareDialogOpen, setShareDialogOpen] = useState(false)
	const [productToShare, setProductToShare] = useState<NDKEvent | null>(null)
	useDashboardTitle('Products')

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

	// Sort products based on orderBy
	const sortedProducts = useMemo(() => {
		if (!products) return []
		return [...products].sort((a, b) => {
			// Alphabetical sorting
			if (orderBy === 'alphabetical') {
				const titleA = getProductTitle(a).toLowerCase()
				const titleB = getProductTitle(b).toLowerCase()
				return titleA.localeCompare(titleB)
			}
			if (orderBy === 'alphabetical-reverse') {
				const titleA = getProductTitle(a).toLowerCase()
				const titleB = getProductTitle(b).toLowerCase()
				return titleB.localeCompare(titleA)
			}
			// Time-based sorting
			const timeA = a.created_at || 0
			const timeB = b.created_at || 0
			if (orderBy === 'oldest' || orderBy === 'least-updated') {
				return timeA - timeB
			} else {
				return timeB - timeA
			}
		})
	}, [products, orderBy])

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

	const handleShareProductClick = (product: NDKEvent) => {
		setProductToShare(product)
		setShareDialogOpen(true)
	}

	const handleDeleteProductClick = async (product: NDKEvent) => {
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
				<div className="flex items-center gap-4">
					<Select value={orderBy} onValueChange={setOrderBy}>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="alphabetical">Alphabetically (A-Z)</SelectItem>
							<SelectItem value="alphabetical-reverse">Alphabetically (Z-A)</SelectItem>
							<SelectItem value="newest">Newest First</SelectItem>
							<SelectItem value="oldest">Oldest First</SelectItem>
							<SelectItem value="recently-updated">Recently Updated</SelectItem>
							<SelectItem value="least-updated">Least Recently Updated</SelectItem>
						</SelectContent>
					</Select>
					<Button
						onClick={handleAddProductClick}
						data-testid="add-product-button"
						className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold"
					>
						<span className="i-product w-5 h-5" /> Add A Product
					</Button>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden space-y-4">
					<Select value={orderBy} onValueChange={setOrderBy}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="alphabetical">Alphabetically (A-Z)</SelectItem>
							<SelectItem value="alphabetical-reverse">Alphabetically (Z-A)</SelectItem>
							<SelectItem value="newest">Newest First</SelectItem>
							<SelectItem value="oldest">Oldest First</SelectItem>
							<SelectItem value="recently-updated">Recently Updated</SelectItem>
							<SelectItem value="least-updated">Least Recently Updated</SelectItem>
						</SelectContent>
					</Select>
					<Button
						onClick={handleAddProductClick}
						data-testid="add-product-button-mobile"
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<span className="i-product w-5 h-5" /> Add A Product
					</Button>
				</div>

				<div>
					{isLoading && <div className="p-6 text-center text-gray-500 mt-4">Loading your products...</div>}
					{error && <div className="p-6 text-center text-red-600 mt-4">Failed to load products: {error.message}</div>}

					{!isLoading && !error && (
						<>
							{sortedProducts && sortedProducts.length > 0 ? (
								<ul ref={animationParent} className="flex flex-col gap-4 mt-4">
									{sortedProducts.map((product) => (
										<li key={product.id}>
											<ProductListItem
												product={product}
												isExpanded={expandedProduct === product.id}
												onToggleExpanded={() => handleToggleExpanded(product.id)}
												onEdit={() => handleEditProductClick(product.id)}
												onShare={() => handleShareProductClick(product)}
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

			{productToShare && (
				<ShareProductDialog
					open={shareDialogOpen}
					onOpenChange={(open) => {
						setShareDialogOpen(open)
						if (!open) setProductToShare(null)
					}}
					productId={getProductId(productToShare) || productToShare.id}
					pubkey={productToShare.pubkey}
					title={getProductTitle(productToShare)}
				/>
			)}
		</div>
	)
}
