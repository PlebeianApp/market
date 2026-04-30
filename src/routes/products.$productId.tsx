import { EntityActionsMenu } from '@/components/EntityActionsMenu'
import { ImageCarousel } from '@/components/ImageCarousel'
import { ImageViewerModal } from '@/components/ImageViewerModal'
import { ItemGrid } from '@/components/ItemGrid'
import { PriceDisplay } from '@/components/PriceDisplay'
import { ProductCard } from '@/components/ProductCard'
import { Comments } from '@/components/Comments'
import { ShippingSelector } from '@/components/ShippingSelector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserCard } from '@/components/UserCard'
import { ZapButton } from '@/components/social/ZapButton'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useEntityPermissions } from '@/hooks/useEntityPermissions'
import { authStore } from '@/lib/stores/auth'
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
	getProductSummary,
	getProductShippingOptions,
	getProductTitle,
	getProductType,
	getProductVisibility,
	getProductWeight,
	isNSFWProduct,
	productQueryOptions,
	productsByPubkeyQueryOptions,
	getProductLocation,
} from '@/queries/products'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { AlertTriangle, ArrowLeft, Edit, Minus, Plus, Truck } from 'lucide-react'
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type JSXElementConstructor,
	type ReactElement,
	type ReactNode,
	type ReactPortal,
} from 'react'
import { toast } from 'sonner'
import { ShareButton } from '@/components/social/ShareButton'
import SocialInteractions from '@/components/social/SocialInteractions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { scrollToElementWithOffset } from '@/lib/utils/ui'
import { normalizePublishedProductShippingTags, resolvePublishedProductShippingOptions } from '@/lib/utils/productShippingSelections'

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

enum TabProductPage {
	description = 'Description',
	spec = 'Spec',
	shipping = 'Shipping',
	comments = 'Comments',
	reviews = 'Reviews',
}

/** Get whether a tab should be enabled (can navigate to) or not.
 * Currently only disable reviews as we work on the functionality.
 */
const getIsTabDisabled = (tab: TabProductPage) => tab === TabProductPage.reviews

type ProductPageShippingState =
	| { status: 'no-published-refs' }
	| { status: 'loading' }
	| { status: 'unavailable' }
	| { status: 'resolved-empty' }
	| { status: 'resolved'; options: RichShippingInfo[] }

const renderProductShippingSelector = (shippingState: ProductPageShippingState, eventProduct: NDKEvent, className: string) => {
	switch (shippingState.status) {
		case 'no-published-refs':
			return <div className="text-sm text-muted-foreground">No shipping options are published for this product.</div>
		case 'loading':
			return <div className="text-sm text-muted-foreground">Loading shipping options...</div>
		case 'unavailable':
			return <div className="text-sm text-red-500">Shipping options unavailable</div>
		case 'resolved-empty':
			return <div className="text-sm text-muted-foreground">No published shipping options could be resolved for this product.</div>
		case 'resolved':
			return (
				<ShippingSelector
					options={shippingState.options}
					onSelect={(option: RichShippingInfo) => {
						void cartActions.setShippingMethod(eventProduct.id, option)
					}}
					className={className}
				/>
			)
	}
}

const getTabContent = (tab: TabProductPage, eventProduct: NDKEvent, isMobileView: boolean, shippingState: ProductPageShippingState) => {
	const wrapContent = (content: ReactNode) => <div className="bg-white shadow-md p-6 rounded-lg">{content}</div>

	const summary = getProductSummary(eventProduct)
	const description = getProductDescription(eventProduct)
	const weightTag = getProductWeight(eventProduct)
	const location = getProductLocation(eventProduct)
	const specs = getProductSpecs(eventProduct)
	const dimensionsTag = getProductDimensions(eventProduct)

	switch (tab) {
		case TabProductPage.description:
			return wrapContent(
				<>
					{summary && <p className="mb-4 pb-4 border-gray-200 border-b text-gray-600 italic">{summary}</p>}
					<p className="text-gray-700 break-words whitespace-pre-wrap">{description}</p>
				</>,
			)
		case TabProductPage.spec:
			const className = isMobileView ? 'grid gap-4 grid-cols-1' : 'grid gap-4 grid-cols-2'
			return wrapContent(
				<div className={className}>
					{weightTag && (
						<div className="flex flex-col">
							<span className="font-medium text-gray-500 text-base">Weight</span>
							<span className="text-gray-900 text-base">
								{weightTag[1]} {weightTag[2]}
							</span>
						</div>
					)}
					{dimensionsTag && (
						<div className="flex flex-col">
							<span className="font-medium text-gray-500 text-base">Dimensions (L×W×H)</span>
							<span className="text-gray-900 text-base break-all">
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
							<span className="font-medium text-gray-500 text-base capitalize">{spec[1]}</span>
							<span className="text-gray-900 text-base break-all">{spec[2]}</span>
						</div>
					))}
					{specs.length === 0 && !weightTag && !dimensionsTag && <p className="col-span-2 text-gray-700">No specifications available</p>}
				</div>,
			)
		case TabProductPage.shipping:
			return wrapContent(
				<div className="flex flex-col gap-6">
					<div className="flex items-center gap-3">
						<Truck className="w-6 h-6 text-gray-500" />
						<h3 className="font-medium text-lg">Shipping Options</h3>
					</div>

					<div className="flex flex-wrap md:flex-nowrap gap-6">
						<div className="w-full md:w-1/2 min-w-0">
							<p className="mb-4 text-gray-500 text-sm">Select a shipping method to see estimated costs and delivery times.</p>

							<div className="w-full">{renderProductShippingSelector(shippingState, eventProduct, 'w-full')}</div>

							<div className="mt-4">
								<p className="text-gray-500 text-sm">Shipping costs will be added to the final price in the cart.</p>
							</div>
						</div>

						<div className="bg-gray-50 p-4 rounded-md w-full md:w-1/2 min-w-0">
							<h4 className="mb-2 font-medium">Shipping Information</h4>

							{weightTag && (
								<div className="flex flex-col mb-2">
									<span className="font-medium text-gray-500 text-base">Weight:</span>
									<span className="text-gray-900 text-base">
										{weightTag[1]} {weightTag[2]}
									</span>
								</div>
							)}

							{dimensionsTag && (
								<div className="flex flex-col mb-2">
									<span className="font-medium text-gray-500 text-base">Dimensions:</span>
									<span className="text-gray-900 text-base">
										<span className="break-all">{dimensionsTag[1]}</span> {dimensionsTag[2]}
									</span>
								</div>
							)}

							{location && (
								<div className="flex flex-col mb-2">
									<span className="font-medium text-gray-500 text-base">Ships from:</span>
									<span className="text-gray-900 text-base">{location}</span>
								</div>
							)}

							<div className="mt-3 text-gray-500 text-sm">Delivery times are estimates and may vary based on your location.</div>
						</div>
					</div>
				</div>,
			)
		case TabProductPage.comments:
			return wrapContent(<Comments targetEvent={eventProduct} />)
		case TabProductPage.reviews:
			return <p>Product Reviews are not implemented yet.</p>
	}
}

function RouteComponent() {
	const { productId } = Route.useLoaderData()
	const { cart } = useCart()
	const { mobileMenuOpen, showNSFWContent, navigation } = useStore(uiStore)
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [currentTab, setCurrentTab] = useState<TabProductPage>(TabProductPage.description)

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
	const images = getProductImages(product) || []
	const priceTag = getProductPrice(product)
	const typeTag = getProductType(product)
	const stockTag = getProductStock(product)
	const visibilityTag = getProductVisibility(product)
	const pubkey = getProductPubkey(product) || ''
	const sellerShippingOptionsQuery = useShippingOptionsByPubkey(pubkey)

	const sellerShippingOptions = useMemo<RichShippingInfo[]>(() => {
		if (!sellerShippingOptionsQuery.data || !pubkey) return []

		return sellerShippingOptionsQuery.data
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info || !info.id || typeof info.id !== 'string' || info.id.trim().length === 0) return null

				return {
					id: createShippingReference(pubkey, info.id),
					name: info.title,
					cost: parseFloat(info.price.amount),
					currency: info.price.currency,
					countries: info.countries,
					service: info.service,
					carrier: info.carrier,
				}
			})
			.filter((option): option is RichShippingInfo => option !== null)
	}, [sellerShippingOptionsQuery.data, pubkey])

	const productShippingSelections = useMemo(() => normalizePublishedProductShippingTags(getProductShippingOptions(product)), [product])

	const productShippingOptions = useMemo(
		() =>
			resolvePublishedProductShippingOptions({
				publishedSelections: productShippingSelections,
				availableOptions: sellerShippingOptions,
			}),
		[productShippingSelections, sellerShippingOptions],
	)
	const hasResolvedSellerShippingState = sellerShippingOptionsQuery.isSuccess || sellerShippingOptionsQuery.data !== undefined

	const productShippingState = useMemo<ProductPageShippingState>(() => {
		if (productShippingSelections.length === 0) return { status: 'no-published-refs' }
		if (!hasResolvedSellerShippingState && sellerShippingOptionsQuery.isError) return { status: 'unavailable' }
		if (!hasResolvedSellerShippingState) return { status: 'loading' }
		if (productShippingOptions.length === 0) return { status: 'resolved-empty' }

		return {
			status: 'resolved',
			options: productShippingOptions,
		}
	}, [hasResolvedSellerShippingState, productShippingOptions, productShippingSelections.length, sellerShippingOptionsQuery.isError])

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
	const isMobileOrTablet = breakpoint === 'sm' || breakpoint === 'md'
	const [quantity, setQuantity] = useState(1)
	const [imageViewerOpen, setImageViewerOpen] = useState(false)
	const [selectedImageIndex, setSelectedImageIndex] = useState(0)
	const commentsSectionRef = useRef<HTMLDivElement>(null)
	const commentInputRef = useRef<HTMLTextAreaElement>(null)

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
			<div className="flex flex-col justify-center items-center gap-3 px-4 h-[50vh] text-center">
				<div className="border-4 border-primary border-t-transparent rounded-full w-8 h-8 animate-spin" />
				<p className="text-muted-foreground">Loading product…</p>
			</div>
		)
	}

	if (!product && productQuery.isError) {
		return (
			<div className="flex flex-col justify-center items-center gap-4 px-4 h-[50vh] text-center">
				<h1 className="font-bold text-2xl">Still loading product</h1>
				<p className="text-gray-600">{productQuery.error instanceof Error ? productQuery.error.message : 'Please try again.'}</p>
				<div className="flex flex-wrap justify-center items-center gap-2">
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
			<div className="flex flex-col justify-center items-center gap-4 px-4 h-[50vh] text-center">
				<h1 className="font-bold text-2xl">Product Not Found</h1>
				<p className="text-gray-600">The product you're looking for doesn't exist (or hasn't propagated to relays yet).</p>
				<Link to="/products" className="inline-flex">
					<Button variant="outline">Back to products</Button>
				</Link>
			</div>
		)
	}

	// Check if this is an NSFW product and user hasn't enabled viewing
	const productIsNSFW = isNSFWProduct(product)
	if (productIsNSFW && !showNSFWContent) {
		return (
			<div className="flex flex-col justify-center items-center gap-4 px-4 h-[50vh] text-center">
				<AlertTriangle className="w-16 h-16 text-amber-500" />
				<h1 className="font-bold text-2xl">Adult Content</h1>
				<p className="max-w-md text-gray-600">
					This product contains adult or sensitive content. To view it, you need to enable adult content viewing in your settings.
				</p>
				<div className="flex gap-3">
					<Link to="/products" className="inline-flex">
						<Button variant="outline">Back to products</Button>
					</Link>
					<Button onClick={() => uiActions.openNSFWConfirmation()} className="bg-amber-600 hover:bg-amber-700">
						Enable adult content
					</Button>
				</div>
			</div>
		)
	}

	// Handle adding product to cart
	const handleAddToCartClick = async () => {
		// Check if we have a valid product and it's not hidden
		if (!product || visibility === 'hidden') return

		// Just add the product ID to the cart with the specified quantity
		await cartActions.addProduct({
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

	const handleNavigateToComments = () => {
		// 1. Open tab view to comments tab

		if (!isMobileOrTablet) {
			// Desktop: switch to comments tab
			setCurrentTab(TabProductPage.comments)
		}

		setTimeout(() => {
			// 2. Scroll to comments section after short delay (to load comments tab)
			const commentsSection = document.getElementById('comments-section')
			if (commentsSection) {
				scrollToElementWithOffset(commentsSection, isMobileOrTablet ? 220 : 300)
			}

			// 3. Focus comments input handler
			const textarea = document.getElementById('comment-input') as HTMLTextAreaElement
			if (textarea) {
				textarea.focus({ preventScroll: true })
			}
		}, 100)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="z-10 relative">
				<div className={`relative hero-container-product ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay" />
						<div className="absolute inset-0 bg-dots-overlay opacity-30" />
					</div>

					<div className="hero-content-product">
						{!mobileMenuOpen && (
							<button onClick={handleBackClick} className="col-span-full back-button">
								<ArrowLeft className="w-6 h-4" />
								<span>Back to results</span>
							</button>
						)}

						<div className="hero-image-container">
							<ImageCarousel images={formattedImages} title={title} onImageClick={handleImageClick} />
						</div>

						<div className="flex flex-col gap-2 mx-auto w-full max-w-[600px] lg:max-w-none text-white">
							<div className="flex justify-between items-center">
								<h1 className="lg:pl-0 font-semibold text-3xl">{title}</h1>
								<div className="flex items-center gap-2">
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
								<Badge className="bg-blue-500">Pre-order</Badge>
							) : (
								<Badge>{stock !== undefined ? `${stock} in stock` : 'Out of stock'}</Badge>
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
										<div className="flex flex-wrap items-center gap-2">
											<div className="flex flex-shrink-0 items-center gap-2">
												<Button
													variant="outline"
													className="text-foreground"
													size="icon"
													onClick={() => setQuantity(Math.max(1, quantity - 1))}
													disabled={quantity <= 1}
												>
													<Minus className="w-6 h-6" />
												</Button>
												<Input
													className="bg-white w-12 font-medium text-black text-center"
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
													variant="outline"
													className="text-foreground"
													size="icon"
													onClick={() => setQuantity(Math.min(stock || quantity + 1, quantity + 1))}
													disabled={quantity >= (stock || quantity)}
												>
													<Plus className="w-6 h-6" />
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
											<Edit className="w-5 h-5" />
											<span>Edit Product</span>
										</Button>
									)}
								</div>
							)}

							<span>Sold by:</span>
							<UserCard pubkey={pubkey} size="md" />

							<SocialInteractions event={product} onCommentButtonPressed={handleNavigateToComments} className="dark" />
						</div>
					</div>
				</div>
				<div className="z-20 relative mx-auto -mt-12 px-4 py-6 max-w-7xl">
					{isMobileOrTablet ? (
						<div className="flex flex-col gap-6">
							{Object.values(TabProductPage).map(
								(tab) =>
									!getIsTabDisabled(tab) && (
										<div>
											<div className="bg-secondary px-4 py-2 rounded-t-md font-medium text-white text-sm">{tab}</div>
											{getTabContent(tab, product, true, productShippingState)}
										</div>
									),
							)}
						</div>
					) : (
						<Tabs defaultValue={TabProductPage.description} value={currentTab} className="w-full">
							<TabsList className="flex flex-wrap justify-start gap-2 bg-transparent p-0 h-auto">
								{Object.values(TabProductPage).map((tab) => (
									<TabsTrigger
										value={tab}
										onClick={() => setCurrentTab(tab)}
										className="data-[state=active]:bg-secondary data-[state=inactive]:bg-gray-100 px-4 py-2 rounded-none font-medium data-[state=active]:text-white data-[state=inactive]:text-black text-sm"
										disabled={getIsTabDisabled(tab)}
									>
										{tab}
									</TabsTrigger>
								))}
							</TabsList>

							{Object.values(TabProductPage).map((tab) => (
								<TabsContent value={tab} className="bg-tertiary mt-4 border-secondary border-t-3">
									{getTabContent(tab, product, false, productShippingState)}
								</TabsContent>
							))}
						</Tabs>
					)}
				</div>
			</div>

			{/* More from this seller */}
			{sellerProducts.filter((p) => p.id !== productId).length > 0 && (
				<div className="flex flex-col gap-4 p-4">
					<h2 className="font-heading text-2xl lg:text-left text-center">More from this seller</h2>
					<ItemGrid className="gap-4 sm:gap-8">
						{sellerProducts
							.filter((p) => p.id !== productId)
							.map((p) => (
								<ProductCard key={p.id} product={p} />
							))}
					</ItemGrid>
				</div>
			)}

			{/* Image Viewer Modal */}
			<ImageViewerModal
				isOpen={imageViewerOpen}
				onClose={() => setImageViewerOpen(false)}
				images={formattedImages.map((img) => ({ url: img.url, title: '' }))}
				currentIndex={selectedImageIndex}
				onIndexChange={setSelectedImageIndex}
			/>
		</div>
	)
}
