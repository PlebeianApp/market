import { ShareProductDialog } from '@/components/dialogs/ShareProductDialog'
import { EntityActionsMenu } from '@/components/EntityActionsMenu'
import { ImageCarousel } from '@/components/ImageCarousel'
import { ImageViewerModal } from '@/components/ImageViewerModal'
import { ItemGrid } from '@/components/ItemGrid'
import { PriceDisplay } from '@/components/PriceDisplay'
import { ProductCard } from '@/components/ProductCard'
import { ProductComments } from '@/components/ProductComments'
import { ShippingSelector } from '@/components/ShippingSelector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserNameWithBadge } from '@/components/UserNameWithBadge'
import { ZapButton } from '@/components/ZapButton'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useEntityPermissions } from '@/hooks/useEntityPermissions'
import { cartActions, useCart, type RichShippingInfo } from '@/lib/stores/cart'
import { ndkActions } from '@/lib/stores/ndk'
import { uiActions, uiStore } from '@/lib/stores/ui'
import { addToBlacklistProducts, removeFromBlacklistProducts } from '@/publish/blacklist'
import { addToFeaturedProducts, removeFromFeaturedProducts } from '@/publish/featured'
import { useBlacklistSettings } from '@/queries/blacklist'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedProducts } from '@/queries/featured'
import {
	getProductCoordinates,
	getProductCategories,
	getProductCreatedAt,
	getProductDescription,
	getProductDimensions,
	getProductImages,
	getProductPrice,
	getProductPubkey,
	getProductSpecs,
	getProductStock,
	getProductTitle,
	getProductType,
	getProductVisibility,
	getProductWeight,
	productQueryOptions,
	productsByPubkeyQueryOptions,
} from '@/queries/products'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Edit, Minus, Plus, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

// Hook to inject dynamic CSS
function useHeroBackground(imageUrl: string, className: string) {
	useEffect(() => {
		if (!imageUrl) return

		const style = document.createElement('style')
		style.textContent = `
			.${className} {
				background-image: url(${imageUrl}) !important;
			}
		`
		document.head.appendChild(style)

		return () => {
			document.head.removeChild(style)
		}
	}, [imageUrl, className])
}

declare module '@tanstack/react-router' {
	interface FileRoutesByPath {
		'/products/$productId': {
			loader: (params: { productId: string }) => { productId: string }
		}
	}
}

export const Route = createFileRoute('/products/$productId')({
	component: RouteComponent,
	loader: ({ params: { productId } }) => ({ productId }),
})

function RouteComponent() {
	const { productId } = Route.useLoaderData()
	const { cart } = useCart()
	const { mobileMenuOpen } = useStore(uiStore)
	const navigate = useNavigate()
	const { navigation } = useStore(uiStore)
	const queryClient = useQueryClient()

	// Scroll to top when product changes
	useEffect(() => {
		window.scrollTo({ top: 0, behavior: 'smooth' })
	}, [productId])

	const productQuery = useQuery({
		...productQueryOptions(productId),
		// Relays can be slow to connect/propagate; keep retrying for a while instead of erroring the whole route.
		retry: (failureCount) => failureCount < 120,
		retryDelay: (attemptIndex) => Math.min(500 + attemptIndex * 750, 5000),
	})

	const product = productQuery.data ?? null

	// Derive all product fields from the loaded product event (avoids conditional hook calls / racey dependent queries)
	const title = getProductTitle(product) || 'Untitled Product'
	const description = getProductDescription(product) || ''
	const images = getProductImages(product) || []
	const priceTag = getProductPrice(product)
	const typeTag = getProductType(product)
	const stockTag = getProductStock(product)
	const visibilityTag = getProductVisibility(product)
	const specs = getProductSpecs(product) || []
	const weightTag = getProductWeight(product)
	const dimensionsTag = getProductDimensions(product)
	const categories = getProductCategories(product) || []
	const createdAt = getProductCreatedAt(product) || 0
	const pubkey = getProductPubkey(product) || ''

	const handleBackClick = () => {
		if (navigation.originalResultsPath) {
			// Navigate to the original results page
			navigate({ to: navigation.originalResultsPath })
			// Clear all product navigation state
			uiActions.clearProductNavigation()
		} else {
			// Fallback to products page if no source path
			navigate({ to: '/products' })
		}
	}

	const sellerProductsQuery = useQuery({
		...productsByPubkeyQueryOptions(pubkey),
		enabled: !!pubkey,
	})
	const sellerProducts = sellerProductsQuery.data ?? []

	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
	const isMobileOrTablet = breakpoint === 'sm' || breakpoint === 'md'
	const [quantity, setQuantity] = useState(1)
	const [imageViewerOpen, setImageViewerOpen] = useState(false)
	const [selectedImageIndex, setSelectedImageIndex] = useState(0)
	const [shareDialogOpen, setShareDialogOpen] = useState(false)

	// Get app config
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey || ''

	// Get entity permissions
	const permissions = useEntityPermissions(pubkey)

	// Get blacklist and featured status
	const { data: blacklistSettings } = useBlacklistSettings(appPubkey)
	const { data: featuredData } = useFeaturedProducts(appPubkey)

	// Determine if this product is blacklisted or featured
	const productCoords = product ? getProductCoordinates(product) : ''
	const isBlacklisted = blacklistSettings?.blacklistedProducts.includes(productCoords) || false
	const isFeatured = featuredData?.featuredProducts.includes(productCoords) || false

	// Derived data from tags
	const price = priceTag ? parseFloat(priceTag[1]) : 0
	const stock = stockTag ? parseInt(stockTag[1]) : undefined
	const visibility = visibilityTag?.[1] || 'on-sale'
	// Out of stock if stock is explicitly 0 or undefined (no stock tag), but not for pre-order items
	const isOutOfStock = visibility !== 'pre-order' && (stock === undefined || stock === 0)
	const productType = typeTag
		? {
				product: typeTag[1],
				delivery: typeTag[2],
			}
		: undefined

	// Format product images for the ImageCarousel component
	const formattedImages = images.map((image) => ({
		url: image[1],
		dimensions: image[2],
		order: image[3] ? parseInt(image[3]) : undefined,
	}))

	// Get first image URL for background
	const backgroundImageUrl = formattedImages[0]?.url || ''

	// Use the hook to inject dynamic CSS for the background image
	const heroClassName = `hero-bg-${productId.replace(/[^a-zA-Z0-9]/g, '')}`
	useHeroBackground(backgroundImageUrl, heroClassName)

	// Keep this route resilient during relay warmup: don't error-boundary the whole page for transient misses.
	if (!product && (productQuery.isLoading || productQuery.isFetching)) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
				<div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
				<p className="text-muted-foreground">Loading product…</p>
			</div>
		)
	}

	if (!product && productQuery.isError) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
				<h1 className="text-2xl font-bold">Still loading product</h1>
				<p className="text-gray-600">{productQuery.error instanceof Error ? productQuery.error.message : 'Please try again.'}</p>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button
						variant="secondary"
						onClick={() => {
							queryClient.invalidateQueries({ queryKey: productQueryOptions(productId).queryKey })
						}}
					>
						Retry
					</Button>
					<Link to="/products" className="inline-flex">
						<Button variant="outline">Back to products</Button>
					</Link>
				</div>
			</div>
		)
	}

	if (!product) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
				<h1 className="text-2xl font-bold">Product Not Found</h1>
				<p className="text-gray-600">The product you’re looking for doesn’t exist (or hasn’t propagated to relays yet).</p>
				<Link to="/products" className="inline-flex">
					<Button variant="outline">Back to products</Button>
				</Link>
			</div>
		)
	}

	// Get location from tags if exists
	const location = product.tags.find((t) => t[0] === 'location')?.[1]

	// Handle adding product to cart
	const handleAddToCartClick = async () => {
		// Check if we have a valid product and it's not hidden
		if (!product || visibility === 'hidden') return

		// Just add the product ID to the cart with the specified quantity
		await cartActions.addProduct(pubkey, {
			id: productId,
			amount: quantity,
			shippingMethodId: null,
			shippingMethodName: null,
			shippingCost: 0,
			shippingCostCurrency: priceTag?.[2] || '',
			sellerPubkey: pubkey,
		})

		// Open the cart drawer
		uiActions.openDrawer('cart')
	}

	// Handle edit product
	const handleEdit = () => {
		navigate({ to: '/dashboard/products/products/$productId', params: { productId } })
	}

	// Handle blacklist toggle
	const handleBlacklistToggle = async () => {
		const ndk = ndkActions.getNDK()
		const signer = ndk?.signer

		if (!ndk || !signer) {
			toast.error('Please connect your wallet to perform this action')
			return
		}

		try {
			if (isBlacklisted) {
				await removeFromBlacklistProducts(productCoords, signer, ndk, appPubkey)
				toast.success('Product removed from blacklist')
			} else {
				await addToBlacklistProducts(productCoords, signer, ndk, appPubkey)
				toast.success('Product added to blacklist')
			}
			// Invalidate queries to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['config', 'blacklist', appPubkey] })
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update blacklist')
		}
	}

	// Handle featured toggle
	const handleFeaturedToggle = async () => {
		const ndk = ndkActions.getNDK()
		const signer = ndk?.signer

		if (!ndk || !signer) {
			toast.error('Please connect your wallet to perform this action')
			return
		}

		try {
			if (isFeatured) {
				await removeFromFeaturedProducts(productCoords, signer, ndk, appPubkey)
				toast.success('Product removed from featured items')
			} else {
				await addToFeaturedProducts(productCoords, signer, ndk, appPubkey)
				toast.success('Product added to featured items')
			}
			// Invalidate queries to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['config', 'featuredProducts', appPubkey] })
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update featured items')
		}
	}

	// Handle image click to open modal
	const handleImageClick = (index: number) => {
		setSelectedImageIndex(index)
		setImageViewerOpen(true)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="relative z-10">
				<div className={`relative hero-container-product ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay" />
					</div>

					<div className="hero-content-product">
						{!mobileMenuOpen && (
							<button onClick={handleBackClick} className="back-button col-span-full">
								<ArrowLeft className="h-4 w-6" />
								<span>Back to results</span>
							</button>
						)}

						<div className="hero-image-container">
							<ImageCarousel images={formattedImages} title={title} onImageClick={handleImageClick} />
						</div>

						<div className="flex flex-col gap-4 text-white w-full max-w-[600px] mx-auto lg:max-w-none">
							<div className="flex items-center justify-between">
								<h1 className="text-3xl font-semibold lg:pl-0">{title}</h1>
								<div className="flex items-center gap-2">
									<ZapButton event={product} />
									<Button
										variant="primary"
										size="icon"
										className="bg-white/10 hover:bg-white/20"
										icon={<span className="i-sharing w-6 h-6" />}
										onClick={() => setShareDialogOpen(true)}
									/>
									{/* Entity Actions Menu for admins/editors/owners */}
									<EntityActionsMenu
										permissions={permissions}
										entityType="product"
										entityId={productId}
										entityCoords={productCoords}
										isBlacklisted={isBlacklisted}
										isFeatured={isFeatured}
										onEdit={permissions.canEdit ? handleEdit : undefined}
										onBlacklist={permissions.canBlacklist && !isBlacklisted ? handleBlacklistToggle : undefined}
										onUnblacklist={permissions.canBlacklist && isBlacklisted ? handleBlacklistToggle : undefined}
										onSetFeatured={permissions.canSetFeatured && !isFeatured ? handleFeaturedToggle : undefined}
										onUnsetFeatured={permissions.canSetFeatured && isFeatured ? handleFeaturedToggle : undefined}
									/>
								</div>
							</div>

							<PriceDisplay
								priceValue={price}
								originalCurrency={priceTag?.[2] || 'SATS'}
								className="space-y-1"
								showSatsPrice={true}
								showOriginalPrice={true}
								showRootCurrency={true}
							/>

							{visibility === 'pre-order' ? (
								<Badge variant="primary" className="bg-blue-500">
									Pre-order
								</Badge>
							) : (
								<Badge variant="primary">{stock !== undefined ? `${stock} in stock` : 'Out of stock'}</Badge>
							)}

							{(() => {
								switch (productType?.product) {
									case 'simple':
										return (
											<div>
												{productType.product.charAt(0).toUpperCase() + productType.product.slice(1)} /{' '}
												{productType.delivery.charAt(0).toUpperCase() + productType.delivery.slice(1)}
											</div>
										)
									case 'variable':
										return (
											<div>
												{productType.product.charAt(0).toUpperCase() + productType.product.slice(1)} /{' '}
												{productType.delivery.charAt(0).toUpperCase() + productType.delivery.slice(1)}
											</div>
										)
									default:
										return null
								}
							})()}

							{stock !== undefined && (
								<div className="flex items-center gap-4">
									{/* Show cart controls for non-owners */}
									{permissions.canAddToCart && (
										<div className="flex items-center gap-2 flex-wrap">
											<div className="flex items-center gap-2 flex-shrink-0">
												<Button
													variant="tertiary"
													size="icon"
													onClick={() => setQuantity(Math.max(1, quantity - 1))}
													disabled={quantity <= 1}
												>
													<Minus className="h-6 w-6" />
												</Button>
												<Input
													className="w-12 text-center font-medium bg-white text-black"
													value={quantity}
													onChange={(e) => {
														const value = parseInt(e.target.value)
														if (!isNaN(value) && value > 0 && value <= (stock || Infinity)) {
															setQuantity(value)
														}
													}}
													min={1}
													max={stock}
													type="number"
												/>
												<Button
													variant="tertiary"
													size="icon"
													onClick={() => setQuantity(Math.min(stock || quantity + 1, quantity + 1))}
													disabled={quantity >= (stock || quantity)}
												>
													<Plus className="h-6 w-6" />
												</Button>
											</div>
											<Button variant="secondary" onClick={handleAddToCartClick} disabled={isOutOfStock || visibility === 'hidden'}>
												{visibility === 'hidden'
													? 'Not Available'
													: isOutOfStock
														? 'Out of Stock'
														: visibility === 'pre-order'
															? 'Pre-order'
															: 'Add to cart'}
											</Button>
										</div>
									)}
									{/* Show edit button for owners */}
									{permissions.canEdit && (
										<Button variant="secondary" onClick={handleEdit} className="flex items-center gap-2">
											<Edit className="h-5 w-5" />
											<span>Edit Product</span>
										</Button>
									)}
								</div>
							)}

							<div className="flex items-center gap-2">
								<span>Sold by:</span>
								<UserNameWithBadge pubkey={pubkey} />
							</div>
						</div>
					</div>
				</div>
				<div className="relative z-20 mx-auto max-w-7xl px-4 py-6 -mt-12">
					{isMobileOrTablet ? (
						<div className="flex flex-col gap-6">
							{/* Description Section */}
							<div>
								<div className="bg-secondary text-white px-4 py-2 text-sm font-medium rounded-t-md">Description</div>
								<div className="rounded-lg bg-white p-6 shadow-md rounded-t-none">
									<p className="whitespace-pre-wrap break-words text-gray-700">{description}</p>
								</div>
							</div>

							{/* Specs Section */}
							<div>
								<div className="bg-secondary text-white px-4 py-2 text-sm font-medium rounded-t-md">Spec</div>
								<div className="rounded-lg bg-white p-6 shadow-md rounded-t-none">
									<div className="grid grid-cols-1 gap-4">
										{weightTag && (
											<div className="flex flex-col">
												<span className="text-base font-medium text-gray-500">Weight</span>
												<span className="text-base text-gray-900">
													{weightTag[1]} {weightTag[2]}
												</span>
											</div>
										)}
										{dimensionsTag && (
											<div className="flex flex-col">
												<span className="text-base font-medium text-gray-500">Dimensions (L×W×H)</span>
												<span className="text-base text-gray-900 break-all">
													{dimensionsTag[1]
														.split('x')
														.map((num) => parseFloat(num).toFixed(1))
														.join('×')}{' '}
													{dimensionsTag[2]}
												</span>
											</div>
										)}
										{specs.map((spec, index) => (
											<div key={index} className="flex flex-col">
												<span className="text-base font-medium text-gray-500 capitalize">{spec[1]}</span>
												<span className="text-base text-gray-900 break-all">{spec[2]}</span>
											</div>
										))}
										{specs.length === 0 && !weightTag && !dimensionsTag && (
											<p className="text-gray-700 col-span-2">No specifications available</p>
										)}
									</div>
								</div>
							</div>

							{/* Shipping Section */}
							<div>
								<div className="bg-secondary text-white px-4 py-2 text-sm font-medium rounded-t-md">Shipping</div>
								<div className="rounded-lg bg-white p-6 shadow-md rounded-t-none">
									<div className="flex flex-col gap-6">
										<div className="flex items-center gap-3">
											<Truck className="h-6 w-6 text-gray-500" />
											<h3 className="text-lg font-medium">Shipping Options</h3>
										</div>

										<div className="flex flex-wrap md:flex-nowrap gap-6">
											<div className="w-full md:w-1/2 min-w-0">
												<p className="text-sm text-gray-500 mb-4">Select a shipping method to see estimated costs and delivery times.</p>

												<div className="w-full">
													<ShippingSelector
														productId={productId}
														onSelect={(option: RichShippingInfo) => {
															// Optional notification could go here
														}}
														className="w-full"
													/>
												</div>

												<div className="mt-4">
													<p className="text-sm text-gray-500">Shipping costs will be added to the final price in the cart.</p>
												</div>
											</div>

											<div className="w-full md:w-1/2 min-w-0 bg-gray-50 p-4 rounded-md">
												<h4 className="font-medium mb-2">Shipping Information</h4>

												{weightTag && (
													<div className="flex flex-col mb-2">
														<span className="text-base font-medium text-gray-500">Weight:</span>
														<span className="text-base text-gray-900">
															{weightTag[1]} {weightTag[2]}
														</span>
													</div>
												)}

												{dimensionsTag && (
													<div className="flex flex-col mb-2">
														<span className="text-base font-medium text-gray-500">Dimensions:</span>
														<span className="text-base text-gray-900">
															<span className="break-all">{dimensionsTag[1]}</span> {dimensionsTag[2]}
														</span>
													</div>
												)}

												{location && (
													<div className="flex flex-col mb-2">
														<span className="text-base font-medium text-gray-500">Ships from:</span>
														<span className="text-base text-gray-900">{location}</span>
													</div>
												)}

												<div className="mt-3 text-sm text-gray-500">Delivery times are estimates and may vary based on your location.</div>
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Comments Section */}
							<div>
								<div className="bg-secondary text-white px-4 py-2 text-sm font-medium rounded-t-md">Comments</div>
								<div className="rounded-lg bg-white p-6 shadow-md rounded-t-none">
									<ProductComments productCoordinates={productCoords} merchantPubkey={pubkey} />
								</div>
							</div>
						</div>
					) : (
						<Tabs defaultValue="description" className="w-full">
							<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-2 justify-start">
								<TabsTrigger
									value="description"
									className="px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Description
								</TabsTrigger>
								<TabsTrigger
									value="specs"
									className="px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Spec
								</TabsTrigger>
								<TabsTrigger
									value="shipping"
									className="px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Shipping
								</TabsTrigger>
								<TabsTrigger
									value="comments"
									className="px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Comments
								</TabsTrigger>
								<TabsTrigger
									value="reviews"
									className="px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
									disabled
								>
									Reviews
								</TabsTrigger>
							</TabsList>

							<TabsContent value="description" className="mt-4 border-t-3 border-secondary bg-tertiary">
								<div className="rounded-lg bg-white p-6 shadow-md">
									<p className="whitespace-pre-wrap break-words text-gray-700">{description}</p>
								</div>
							</TabsContent>

							<TabsContent value="specs" className="mt-4 border-t-3 border-secondary bg-tertiary">
								<div className="rounded-lg bg-white p-6 shadow-md">
									<div className="grid grid-cols-2 gap-4">
										{weightTag && (
											<div className="flex flex-col">
												<span className="text-base font-medium text-gray-500">Weight</span>
												<span className="text-base text-gray-900">
													{weightTag[1]} {weightTag[2]}
												</span>
											</div>
										)}
										{dimensionsTag && (
											<div className="flex flex-col">
												<span className="text-base font-medium text-gray-500">Dimensions (L×W×H)</span>
												<span className="text-base text-gray-900 break-all">
													{dimensionsTag[1]
														.split('x')
														.map((num) => parseFloat(num).toFixed(1))
														.join('×')}{' '}
													{dimensionsTag[2]}
												</span>
											</div>
										)}
										{specs.map((spec, index) => (
											<div key={index} className="flex flex-col">
												<span className="text-base font-medium text-gray-500 capitalize">{spec[1]}</span>
												<span className="text-base text-gray-900 break-all">{spec[2]}</span>
											</div>
										))}
										{specs.length === 0 && !weightTag && !dimensionsTag && (
											<p className="text-gray-700 col-span-2">No specifications available</p>
										)}
									</div>
								</div>
							</TabsContent>

							<TabsContent value="shipping" className="mt-4 border-t-3 border-secondary bg-tertiary">
								<div className="rounded-lg bg-white p-6 shadow-md">
									<div className="flex flex-col gap-6">
										<div className="flex items-center gap-3">
											<Truck className="h-6 w-6 text-gray-500" />
											<h3 className="text-lg font-medium">Shipping Options</h3>
										</div>

										<div className="flex flex-wrap md:flex-nowrap gap-6">
											<div className="w-full md:w-1/2 min-w-0">
												<p className="text-sm text-gray-500 mb-4">Select a shipping method to see estimated costs and delivery times.</p>

												<div className="w-full">
													<ShippingSelector
														productId={productId}
														onSelect={(option: RichShippingInfo) => {
															// Optional notification could go here
														}}
														className="w-full"
													/>
												</div>

												<div className="mt-4">
													<p className="text-sm text-gray-500">Shipping costs will be added to the final price in the cart.</p>
												</div>
											</div>

											<div className="w-full md:w-1/2 min-w-0 bg-gray-50 p-4 rounded-md">
												<h4 className="font-medium mb-2">Shipping Information</h4>

												{weightTag && (
													<div className="flex flex-col mb-2">
														<span className="text-base font-medium text-gray-500">Weight:</span>
														<span className="text-base text-gray-900">
															{weightTag[1]} {weightTag[2]}
														</span>
													</div>
												)}

												{dimensionsTag && (
													<div className="flex flex-col mb-2">
														<span className="text-base font-medium text-gray-500">Dimensions:</span>
														<span className="text-base text-gray-900">
															<span className="break-all">{dimensionsTag[1]}</span> {dimensionsTag[2]}
														</span>
													</div>
												)}

												{location && (
													<div className="flex flex-col mb-2">
														<span className="text-base font-medium text-gray-500">Ships from:</span>
														<span className="text-base text-gray-900">{location}</span>
													</div>
												)}

												<div className="mt-3 text-sm text-gray-500">Delivery times are estimates and may vary based on your location.</div>
											</div>
										</div>
									</div>
								</div>
							</TabsContent>

							<TabsContent value="comments" className="mt-4 border-t-3 border-secondary bg-tertiary">
								<div className="rounded-lg bg-white p-6 shadow-md">
									<ProductComments productCoordinates={productCoords} merchantPubkey={pubkey} />
								</div>
							</TabsContent>
						</Tabs>
					)}
				</div>
			</div>

			{/* More from this seller */}
			<div className="flex flex-col gap-4 p-4">
				<h2 className="font-heading text-2xl text-center lg:text-left">More from this seller</h2>
				<ItemGrid className="gap-4 sm:gap-8">
					{sellerProducts.map((p) => (
						<ProductCard key={p.id} product={p} />
					))}
				</ItemGrid>
			</div>

			{/* Image Viewer Modal */}
			<ImageViewerModal
				isOpen={imageViewerOpen}
				onClose={() => setImageViewerOpen(false)}
				images={formattedImages.map((img) => ({ url: img.url, title: '' }))}
				currentIndex={selectedImageIndex}
				onIndexChange={setSelectedImageIndex}
			/>

			{/* Share Product Dialog */}
			<ShareProductDialog open={shareDialogOpen} onOpenChange={setShareDialogOpen} productId={productId} pubkey={pubkey} title={title} />
		</div>
	)
}
