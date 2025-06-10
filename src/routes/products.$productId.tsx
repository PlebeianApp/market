import { ImageCarousel } from '@/components/ImageCarousel'
import { ItemGrid } from '@/components/ItemGrid'
import { ProductCard } from '@/components/ProductCard'
import { ProfileName } from '@/components/ProfileName'
import { ShippingSelector } from '@/components/ShippingSelector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserNameWithBadge } from '@/components/UserNameWithBadge'
import { ZapButton } from '@/components/ZapButton'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cartActions, useCart, type RichShippingInfo } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import {
	productQueryOptions,
	productsByPubkeyQueryOptions,
	useProductCategories,
	useProductCreatedAt,
	useProductDescription,
	useProductDimensions,
	useProductImages,
	useProductPrice,
	useProductPubkey,
	useProductSpecs,
	useProductStock,
	useProductTitle,
	useProductType,
	useProductVisibility,
	useProductWeight,
} from '@/queries/products'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { FileRoutesByPath } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Minus, Plus, Truck } from 'lucide-react'
import { useState } from 'react'

declare module '@tanstack/react-router' {
	interface FileRoutesByPath {
		'/products/$productId': {
			loader: (params: { productId: string }) => { productId: string }
		}
	}
}

export const Route = createFileRoute('/products/$productId')({
	component: RouteComponent,
	loader: ({ params: { productId } }) => {
		return { productId }
	},
})

function RouteComponent() {
	const { productId } = Route.useLoaderData()
	const { data: product } = useSuspenseQuery(productQueryOptions(productId))
	const { cart } = useCart()

	if (!product) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4">
				<h1 className="text-2xl font-bold">Product Not Found</h1>
				<p className="text-gray-600">The product you're looking for doesn't exist.</p>
			</div>
		)
	}

	// Get all product data using hooks
	const { data: title = 'Untitled Product' } = useProductTitle(productId)
	const { data: description = '' } = useProductDescription(productId)
	const { data: images = [] } = useProductImages(productId)
	const { data: priceTag } = useProductPrice(productId)
	const { data: typeTag } = useProductType(productId)
	const { data: stockTag } = useProductStock(productId)
	const { data: visibilityTag } = useProductVisibility(productId)
	const { data: specs = [] } = useProductSpecs(productId)
	const { data: weightTag } = useProductWeight(productId)
	const { data: dimensionsTag } = useProductDimensions(productId)
	const { data: categories = [] } = useProductCategories(productId)
	const { data: createdAt = 0 } = useProductCreatedAt(productId)
	const { data: pubkey = '' } = useProductPubkey(productId)

	const { data: sellerProducts = [] } = useSuspenseQuery(productsByPubkeyQueryOptions(pubkey || 'placeholder'))

	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
	const isMobileOrTablet = breakpoint === 'sm' || breakpoint === 'md'
	const [quantity, setQuantity] = useState(1)

	// Derived data from tags
	const price = priceTag ? parseFloat(priceTag[1]) : 0
	const stock = stockTag ? parseInt(stockTag[1]) : undefined
	const status = visibilityTag ? visibilityTag[1] : 'active'
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

	// Get location from tags if exists
	const location = product.tags.find((t) => t[0] === 'location')?.[1]

	// Handle adding product to cart
	const handleAddToCartClick = async () => {
		// Check if we have a valid product
		if (!product) return

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

	return (
		<div className="flex flex-col gap-4">
			<div className="relative">
				<Button
					variant="ghost"
					onClick={() => window.history.back()}
					className="absolute left-0 lg:left-2 top-0 z-10 flex items-center gap-2 text-white hover:bg-white/10"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to results</span>
				</Button>
				<div 
					className={`relative min-h-[400px] ${!backgroundImageUrl ? 'bg-black' : ''}`}
					style={{
						backgroundImage: backgroundImageUrl ? `url(${backgroundImageUrl})` : undefined,
						backgroundSize: 'cover',
						backgroundPosition: 'center',
						backgroundRepeat: 'no-repeat'
					}}
				>
					{/* Black radial gradient overlay */}
					<div className="absolute inset-0 bg-radial-overlay" />
					
					{/* Dots pattern overlay */}
					<div className="absolute inset-0 opacity-30 pointer-events-none bg-dots-overlay" />
					
					{/* Content container */}
					<div className="relative z-10 container mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 p-4 pb-16 lg:p-16">
						<div className="max-h-[65vh] lg:h-[45vh] mt-8">
							<ImageCarousel 
								images={formattedImages} 
								title={title}
							/>
						</div>

						<div className="flex flex-col gap-8 text-white lg:justify-center">
							<div className="flex items-center justify-between">
								<h1 className="text-3xl font-semibold lg:pl-0">{title}</h1>
								<div className="flex items-center gap-2">
									<ZapButton event={product} />
									<Button
										variant="primary"
										size="icon"
										className="bg-white/10 hover:bg-white/20"
										icon={<span className="i-sharing w-6 h-6" />}
									/>
								</div>
							</div>

							<div className="space-y-1">
								<p className="text-2xl font-bold">{price.toLocaleString()} sats</p>
								<p className="text-sm text-gray-400">€{(price * 0.0004).toFixed(2)} EUR</p>
							</div>

							<Badge variant="primary">{stock !== undefined ? `${stock} in stock` : 'Out of stock'}</Badge>

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
									<div className="flex items-center gap-2">
										<Button variant="tertiary" size="icon" onClick={() => setQuantity(Math.max(1, quantity - 1))} disabled={quantity <= 1}>
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
										<Button variant="secondary" onClick={handleAddToCartClick} disabled={stock === 0}>
											Add to cart
										</Button>
									</div>
								</div>
							)}

							<div className="flex items-center gap-2">
								<span>Sold by:</span>
								<UserNameWithBadge userId={pubkey} />
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
									<div className="grid grid-cols-2 gap-4">
										{weightTag && (
											<div className="flex flex-col">
												<span className="text-sm font-medium text-gray-500">Weight</span>
												<span className="text-gray-900">
													{weightTag[1]} {weightTag[2]}
												</span>
											</div>
										)}
										{dimensionsTag && (
											<div className="flex flex-col">
												<span className="text-sm font-medium text-gray-500">Dimensions (L×W×H)</span>
												<span className="text-gray-900">
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
												<span className="text-sm font-medium text-gray-500">{spec[1]}</span>
												<span className="text-gray-900">{spec[2]}</span>
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

										<div className="grid md:grid-cols-2 gap-6">
											<div>
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

											<div className="bg-gray-50 p-4 rounded-md">
												<h4 className="font-medium mb-2">Shipping Information</h4>

												{weightTag && (
													<div className="text-sm text-gray-600 mb-2">
														<span className="font-medium">Weight:</span> {weightTag[1]} {weightTag[2]}
													</div>
												)}

												{dimensionsTag && (
													<div className="text-sm text-gray-600 mb-2">
														<span className="font-medium">Dimensions:</span> {dimensionsTag[1]} {dimensionsTag[2]}
													</div>
												)}

												{location && (
													<div className="text-sm text-gray-600 mb-2">
														<span className="font-medium">Ships from:</span> {location}
													</div>
												)}

												<div className="mt-3 text-sm text-gray-500">Delivery times are estimates and may vary based on your location.</div>
											</div>
										</div>
									</div>
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
									disabled
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
												<span className="text-sm font-medium text-gray-500">Weight</span>
												<span className="text-gray-900">
													{weightTag[1]} {weightTag[2]}
												</span>
											</div>
										)}
										{dimensionsTag && (
											<div className="flex flex-col">
												<span className="text-sm font-medium text-gray-500">Dimensions (L×W×H)</span>
												<span className="text-gray-900">
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
												<span className="text-sm font-medium text-gray-500">{spec[1]}</span>
												<span className="text-gray-900">{spec[2]}</span>
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

										<div className="grid md:grid-cols-2 gap-6">
											<div>
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

											<div className="bg-gray-50 p-4 rounded-md">
												<h4 className="font-medium mb-2">Shipping Information</h4>

												{weightTag && (
													<div className="text-sm text-gray-600 mb-2">
														<span className="font-medium">Weight:</span> {weightTag[1]} {weightTag[2]}
													</div>
												)}

												{dimensionsTag && (
													<div className="text-sm text-gray-600 mb-2">
														<span className="font-medium">Dimensions:</span> {dimensionsTag[1]} {dimensionsTag[2]}
													</div>
												)}

												{location && (
													<div className="text-sm text-gray-600 mb-2">
														<span className="font-medium">Ships from:</span> {location}
													</div>
												)}

												<div className="mt-3 text-sm text-gray-500">Delivery times are estimates and may vary based on your location.</div>
											</div>
										</div>
									</div>
								</div>
							</TabsContent>
						</Tabs>
					)}
				</div>
			</div>
			<div className="lg:px-8 px-4 py-6">
				{sellerProducts.length > 0 && (
					<ItemGrid
						title={
							<div className="flex flex-col items-center lg:flex-row lg:items-center lg:gap-2">
								<span className="text-2xl font-heading">More products from </span>
								<ProfileName pubkey={pubkey} className="text-2xl font-heading" />
							</div>
						}
					>
						{sellerProducts.map((product) => (
							<ProductCard key={product.id} product={product} />
						))}
					</ItemGrid>
				)}
			</div>
		</div>
	)
}
