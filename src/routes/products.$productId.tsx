import { Button } from '@/components/ui/button'
import { ImageCarousel } from '@/components/ImageCarousel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/utils'
import {
	productQueryOptions,
	useProductDescription,
	useProductImages,
	useProductTitle,
	useProductPrice,
	useProductType,
	useProductStock,
	useProductVisibility,
	useProductSpecs,
	useProductWeight,
	useProductDimensions,
	useProductCategories,
	useProductCreatedAt,
	useProductPubkey,
} from '@/queries/products'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { FileRoutesByPath } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Minus, Plus, Share2 } from 'lucide-react'
import { ZapButton } from '@/components/ZapButton'
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

	// Original product query to keep the suspense behavior
	const { data: product } = useSuspenseQuery({
		...productQueryOptions(productId),
	})

	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
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

	if (!product) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4">
				<h1 className="text-2xl font-bold">Product Not Found</h1>
				<p className="text-gray-600">The product you're looking for doesn't exist.</p>
			</div>
		)
	}

	// Transform specs into key-value objects for easier display
	const specsFormatted = specs.map((spec) => ({
		key: spec[1],
		value: spec[2],
	}))

	// Format product images for the ImageCarousel component
	const formattedImages = images.map((image) => ({
		url: image[1],
		dimensions: image[2],
		order: image[3] ? parseInt(image[3]) : undefined,
	}))

	// Seller mock data (should be replaced with proper profile data)
	const seller = {
		id: pubkey,
		name: pubkey.slice(0, 8) + '...',
	}

	// Get location from tags if exists
	const location = product.tags.find((t) => t[0] === 'location')?.[1]

	return (
		<div className="relative min-h-screen">
			<Button
				variant="ghost"
				onClick={() => window.history.back()}
				className="absolute left-4 top-4 z-10 flex items-center gap-2 text-white hover:bg-white/10"
			>
				<ArrowLeft className="h-4 w-4" />
				<span>Back to results</span>
			</Button>
			<div className=" bg-black">
				<div className="container mx-auto grid grid-cols-1 lg:grid-cols-2 mx-auto">
					<div className="max-h-[60vh] lg:h-[40vh] overflow-hidden">
						<ImageCarousel images={formattedImages} title={title} />
					</div>

					<div className="flex flex-col gap-6 p-8 text-white">
						<div className="space-y-4">
							<h1 className="text-3xl font-bold">{title}</h1>
							<p className="text-lg text-gray-300">{description}</p>
						</div>

						<div className="flex items-center justify-between">
							<div className="space-y-1">
								<p className="text-2xl font-bold">{price.toLocaleString()} sats</p>
								<p className="text-sm text-gray-400">€{price.toFixed(2)} EUR</p>
							</div>
							<div className="flex items-center gap-2">
								<Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20">
									<Share2 className="h-5 w-5" />
								</Button>
								<ZapButton recipientId={seller.id} />
							</div>
						</div>

						{stock !== undefined && (
							<div className="flex items-center gap-4">
								<span className="text-sm text-gray-300">{stock} in stock</span>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="icon"
										onClick={() => setQuantity(Math.max(1, quantity - 1))}
										disabled={quantity <= 1}
										className="border-white/20 bg-white/10 hover:bg-white/20"
									>
										<Minus className="h-4 w-4" />
									</Button>
									<span className="w-8 text-center">{quantity}</span>
									<Button
										variant="outline"
										size="icon"
										onClick={() => setQuantity(Math.min(stock || quantity + 1, quantity + 1))}
										disabled={quantity >= (stock || quantity)}
										className="border-white/20 bg-white/10 hover:bg-white/20"
									>
										<Plus className="h-4 w-4" />
									</Button>
								</div>
							</div>
						)}

						<Button size="lg" className="w-full bg-white text-black hover:bg-white/90">
							Add to cart
						</Button>

						<div className="flex flex-col gap-2 text-gray-300">
							<div className="flex items-center gap-2">
								<span className="text-sm text-gray-400">Status:</span>
								<span
									className={cn(
										'inline-block rounded-full px-3 py-1 text-xs font-medium',
										status === 'on-sale' && 'bg-green-500/20 text-green-300',
										status === 'hidden' && 'bg-red-500/20 text-red-300',
										status === 'pre-order' && 'bg-gray-500/20 text-gray-300',
									)}
								>
									{status.charAt(0).toUpperCase() + status.slice(1)}
								</span>
							</div>

							{productType && (
								<div className="flex items-center gap-2">
									<span className="text-sm text-gray-400">Type:</span>
									<span className="text-sm">
										{productType.product.charAt(0).toUpperCase() + productType.product.slice(1)} /{' '}
										{productType.delivery.charAt(0).toUpperCase() + productType.delivery.slice(1)}
									</span>
								</div>
							)}

							<div className="flex items-center gap-2">
								<span className="text-sm text-gray-400">Listed:</span>
								<span className="text-sm">{new Date(createdAt * 1000).toLocaleDateString()}</span>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div className="mx-auto max-w-7xl px-4 py-6">
				<Tabs defaultValue="description" className="w-full">
					<TabsList className="w-full flex flex-row gap-3 bg-transparent justify-start">
						<TabsTrigger value="description">Description</TabsTrigger>
						<TabsTrigger value="specs">Specifications</TabsTrigger>
						<TabsTrigger value="shipping">Shipping</TabsTrigger>
						<TabsTrigger value="comments" disabled>
							Comments
						</TabsTrigger>
						<TabsTrigger value="reviews" disabled>
							Reviews
						</TabsTrigger>
					</TabsList>

					<TabsContent value="description" className="mt-4">
						<div className="rounded-lg bg-white p-6 shadow-md">
							<p className="whitespace-pre-wrap text-gray-700">{description}</p>
						</div>
					</TabsContent>

					<TabsContent value="specs" className="mt-4">
						<div className="rounded-lg bg-white p-6 shadow-md">
							<div className="grid grid-cols-2 gap-4">
								{specsFormatted.map((spec, index) => (
									<div key={index} className="flex flex-col">
										<span className="text-sm font-medium text-gray-500">{spec.key}</span>
										<span className="text-gray-900">{spec.value}</span>
									</div>
								))}
								{specsFormatted.length === 0 && <p className="text-gray-700 col-span-2">No specifications available</p>}
							</div>
						</div>
					</TabsContent>

					<TabsContent value="shipping" className="mt-4">
						<div className="rounded-lg bg-white p-6 shadow-md">
							<p className="text-gray-700">Shipping information not available</p>
						</div>
					</TabsContent>
				</Tabs>

				<div className="mt-8 rounded-lg bg-white p-6 shadow-md">
					<div className="flex flex-col gap-6">
						<div className="flex items-center justify-between">
							<div>
								<h3 className="text-lg font-semibold">Seller</h3>
								<p className="text-gray-600">{seller.name}</p>
								{location && <p className="text-sm text-gray-500">{location}</p>}
							</div>
							<Button variant="outline" className="gap-2">
								<span>Contact</span>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
