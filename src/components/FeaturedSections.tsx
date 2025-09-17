import { CollectionCard } from '@/components/CollectionCard'
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
		enabled: !!pubkey && !!dTag,
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

// Component for displaying a featured user
function FeaturedUserItem({ userPubkey }: { userPubkey: string }) {
	return (
		<Card className="p-4 hover:shadow-md transition-shadow">
			<Link to="/profile/$profileId" params={{ profileId: userPubkey }} className="block">
				<div className="flex flex-col items-center text-center space-y-3">
					<UserWithAvatar pubkey={userPubkey} size="lg" showBadge={true} disableLink={true} />
					<Button variant="outline" size="sm" className="w-full">
						View Profile
					</Button>
				</div>
			</Link>
		</Card>
	)
}

// Main component for displaying all featured sections
export function FeaturedSections({ className, maxItemsPerSection = 5 }: FeaturedSectionsProps) {
	const { data: config } = useConfigQuery()
	const { data: featuredProducts, isLoading: isLoadingProducts } = useFeaturedProducts(config?.appPublicKey || '')
	const { data: featuredCollections, isLoading: isLoadingCollections } = useFeaturedCollections(config?.appPublicKey || '')
	const { data: featuredUsers, isLoading: isLoadingUsers } = useFeaturedUsers(config?.appPublicKey || '')

	// Get limited items for display
	const displayProducts = featuredProducts?.featuredProducts?.slice(0, maxItemsPerSection) || []
	const displayCollections = featuredCollections?.featuredCollections?.slice(0, maxItemsPerSection) || []
	const displayUsers = featuredUsers?.featuredUsers?.slice(0, maxItemsPerSection) || []

	// Count total items to determine layout
	const totalSections = [displayProducts.length > 0, displayCollections.length > 0, displayUsers.length > 0].filter(Boolean).length

	if (isLoadingProducts || isLoadingCollections || isLoadingUsers) {
		return (
			<div className={cn('space-y-8', className)}>
				<div className="animate-pulse space-y-6">
					<div className="bg-gray-200 h-8 rounded w-48"></div>
					<div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
						{Array.from({ length: 5 }).map((_, i) => (
							<div key={i} className="bg-gray-200 aspect-square rounded-lg"></div>
						))}
					</div>
				</div>
			</div>
		)
	}

	// Don't render anything if no featured items
	if (totalSections === 0) {
		return null
	}

	// Create array of visible sections with their index for alternating backgrounds
	const visibleSections = [
		{ type: 'products', visible: displayProducts.length > 0 },
		{ type: 'collections', visible: displayCollections.length > 0 },
		{ type: 'users', visible: displayUsers.length > 0 },
	].filter((section) => section.visible)

	let sectionIndex = 0

	return (
		<div className={cn('space-y-0', className)}>
			{/* Featured Products */}
			{displayProducts.length > 0 && (
				<section className={cn('px-8 py-12', sectionIndex++ % 2 === 0 ? 'bg-transparent' : 'bg-off-black')}>
					<div className="flex items-center justify-between mb-6">
						<div className="flex items-center gap-3">
							<Package className="w-6 h-6 text-primary" />
							<h2 className="text-2xl font-heading">Featured Products</h2>
						</div>
						{featuredProducts?.featuredProducts && featuredProducts.featuredProducts.length > maxItemsPerSection && (
							<Link to="/products">
								<Button variant="ghost" size="sm" className="flex items-center gap-2">
									View All <ArrowRight className="w-4 h-4" />
								</Button>
							</Link>
						)}
					</div>
					<ItemGrid className="gap-8">
						{displayProducts.map((productCoords) => (
							<FeaturedProductItem key={productCoords} productCoords={productCoords} />
						))}
					</ItemGrid>
				</section>
			)}

			{/* Featured Collections */}
			{displayCollections.length > 0 && (
				<section className={cn('px-8 py-12', sectionIndex++ % 2 === 0 ? 'bg-transparent' : 'bg-off-black')}>
					<div className="flex items-center justify-between mb-6">
						<div className="flex items-center gap-3">
							<FolderOpen className="w-6 h-6 text-primary" />
							<h2 className="text-2xl font-heading">Featured Collections</h2>
						</div>
						{featuredCollections?.featuredCollections && featuredCollections.featuredCollections.length > maxItemsPerSection && (
							<Button variant="ghost" size="sm" className="flex items-center gap-2">
								View All <ArrowRight className="w-4 h-4" />
							</Button>
						)}
					</div>
					<ItemGrid className="gap-8">
						{displayCollections.map((collectionCoords) => (
							<FeaturedCollectionItem key={collectionCoords} collectionCoords={collectionCoords} />
						))}
					</ItemGrid>
				</section>
			)}

			{/* Featured Users */}
			{displayUsers.length > 0 && (
				<section className={cn('px-8 py-12', sectionIndex++ % 2 === 0 ? 'bg-transparent' : 'bg-off-black')}>
					<div className="flex items-center justify-between mb-6">
						<div className="flex items-center gap-3">
							<Users className="w-6 h-6 text-primary" />
							<h2 className="text-2xl font-heading">Featured Sellers</h2>
						</div>
					</div>
					<ItemGrid className="gap-8">
						{displayUsers.map((userPubkey) => (
							<FeaturedUserItem key={userPubkey} userPubkey={userPubkey} />
						))}
					</ItemGrid>
				</section>
			)}
		</div>
	)
}
