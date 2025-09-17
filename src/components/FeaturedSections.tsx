import { CollectionCard } from '@/components/CollectionCard'
import { FeaturedUserCard } from '@/components/FeaturedUserCard'
import { ItemGrid } from '@/components/ItemGrid'
import { ProductCard } from '@/components/ProductCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { cn } from '@/lib/utils'
import { collectionByATagQueryOptions } from '@/queries/collections'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedCollections, useFeaturedProducts, useFeaturedUsers } from '@/queries/featured'
import { productByATagQueryOptions } from '@/queries/products'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, FolderOpen, Package, Users } from 'lucide-react'

interface FeaturedSectionsProps {
	className?: string
	maxItemsPerSection?: number
}

// Component for displaying a featured product
function FeaturedProductItem({ productCoords }: { productCoords: string }) {
	// Extract pubkey and dTag from coordinates (format: kind:pubkey:dtag)
	const [, pubkey, dTag] = productCoords.split(':')

	const { data: product, isLoading } = useQuery({
		...productByATagQueryOptions(pubkey, dTag),
		enabled: !!(pubkey && dTag),
	})

	if (isLoading) {
		return (
			<div className="animate-pulse">
				<div className="bg-gray-200 aspect-square rounded-lg mb-2"></div>
				<div className="bg-gray-200 h-4 rounded mb-1"></div>
				<div className="bg-gray-200 h-3 rounded w-2/3"></div>
			</div>
		)
	}

	if (!product) return null

	return <ProductCard product={product} />
}

// Component for displaying a featured collection
function FeaturedCollectionItem({ collectionCoords }: { collectionCoords: string }) {
	// Extract pubkey and dTag from coordinates (format: kind:pubkey:dtag)
	const coordsParts = collectionCoords.split(':')
	const pubkey = coordsParts[1] || ''
	const dTag = coordsParts[2] || ''

	const { data: collection, isLoading } = useQuery({
		...collectionByATagQueryOptions(pubkey, dTag),
		enabled: !!(pubkey && dTag),
	})

	if (isLoading) {
		return (
			<div className="animate-pulse">
				<div className="bg-gray-200 aspect-square rounded-lg mb-2"></div>
				<div className="bg-gray-200 h-4 rounded mb-1"></div>
				<div className="bg-gray-200 h-3 rounded w-2/3"></div>
			</div>
		)
	}

	if (!collection) return null

	return <CollectionCard collection={collection} />
}

// FeaturedUserItem has been replaced with FeaturedUserCard component

// Main component for displaying all featured sections
export function FeaturedSections({ className, maxItemsPerSection = 5 }: FeaturedSectionsProps) {
	const { data: config } = useConfigQuery()
	const { data: featuredProducts } = useFeaturedProducts(config?.appPublicKey || '')
	const { data: featuredCollections } = useFeaturedCollections(config?.appPublicKey || '')
	const { data: featuredUsers } = useFeaturedUsers(config?.appPublicKey || '')

	// Limit items per section
	const displayProducts = featuredProducts?.featuredProducts?.slice(0, maxItemsPerSection) || []
	const displayCollections = featuredCollections?.featuredCollections?.slice(0, maxItemsPerSection) || []
	const displayUsers = featuredUsers?.featuredUsers?.slice(0, maxItemsPerSection) || []

	// Track section index for alternating backgrounds
	let sectionIndex = 0

	return (
		<div className={cn('w-full', className)}>
			{/* Featured Products */}
			{displayProducts.length > 0 && (
				<section className={cn('w-full py-12', sectionIndex++ % 2 === 0 ? 'bg-transparent' : 'bg-off-black')}>
					<div className="px-8">
						<div className="flex items-center justify-between mb-6">
							<div className="flex items-center gap-3">
								<Package className="w-6 h-6 text-primary" />
								<h2 className="text-2xl font-heading">Featured Products</h2>
							</div>
							{featuredProducts?.featuredProducts && featuredProducts.featuredProducts.length > maxItemsPerSection && (
								<Link to="/products" className="flex items-center gap-2 text-primary hover:underline">
									<Button variant="ghost" size="sm" className="gap-2">
										View All <ArrowRight className="w-4 h-4" />
									</Button>
								</Link>
							)}
						</div>
						<ItemGrid className="gap-8">
							{displayProducts.map((productCoords: string) => (
								<FeaturedProductItem key={productCoords} productCoords={productCoords} />
							))}
						</ItemGrid>
					</div>
				</section>
			)}

			{/* Featured Collections */}
			{displayCollections.length > 0 && (
				<section className={cn('w-full py-12', sectionIndex++ % 2 === 0 ? 'bg-transparent' : 'bg-off-black')}>
					<div className="px-8">
						<div className="flex items-center justify-between mb-6">
							<div className="flex items-center gap-3">
								<FolderOpen className="w-6 h-6 text-primary text-white" />
								<h2 className="text-2xl font-heading text-white">Featured Collections</h2>
							</div>
							{featuredCollections?.featuredCollections && featuredCollections.featuredCollections.length > maxItemsPerSection && (
								<Link to="/collections" className="flex items-center gap-2 text-primary hover:underline">
									<Button variant="ghost" size="sm" className="gap-2">
										View All <ArrowRight className="w-4 h-4" />
									</Button>
								</Link>
							)}
						</div>
						<ItemGrid className="gap-8">
							{displayCollections.map((collectionCoords: string) => (
								<FeaturedCollectionItem key={collectionCoords} collectionCoords={collectionCoords} />
							))}
						</ItemGrid>
					</div>
				</section>
			)}

			{/* Featured Users */}
			{displayUsers.length > 0 && (
				<section className={cn('w-full py-12', sectionIndex++ % 2 === 0 ? 'bg-transparent' : 'bg-off-black')}>
					<div className="px-8">
						<div className="flex items-center justify-between mb-6">
							<div className="flex items-center gap-3">
								<Users className="w-6 h-6 text-primary" />
								<h2 className="text-2xl font-heading">Featured Sellers</h2>
							</div>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
							{displayUsers.map((userPubkey: string) => (
								<FeaturedUserCard key={userPubkey} userPubkey={userPubkey} />
							))}
						</div>
					</div>
				</section>
			)}
		</div>
	)
}
