import { Card } from '@/components/ui/card'
import {
	getProductImages,
	getProductPrice,
	getProductTitle,
	productByATagQueryOptions,
	productsByPubkeyQueryOptions,
} from '@/queries/products'
import { profileQueryOptions } from '@/queries/profiles'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { nip19 } from 'nostr-tools'

interface FeaturedUserCardProps {
	userPubkey: string
}

// Mini product card component for displaying user's products
function MiniProductCard({ productCoords }: { productCoords: string }) {
	// Extract pubkey and dTag from coordinates (format: kind:pubkey:dtag)
	const [, pubkey, dTag] = productCoords.split(':')

	const { data: product, isLoading } = useQuery({
		...productByATagQueryOptions(pubkey, dTag),
		enabled: !!(pubkey && dTag),
	})

	if (isLoading) {
		return (
			<div className="animate-pulse">
				<div className="bg-gray-200 aspect-square rounded-lg mb-1"></div>
				<div className="bg-gray-200 h-3 rounded"></div>
			</div>
		)
	}

	if (!product) return null

	const title = getProductTitle(product)
	const images = getProductImages(product)
	const price = getProductPrice(product)

	return (
		<Link to="/product/$productId" params={{ productId: product.id }} className="block">
			<div className="group cursor-pointer">
				<div className="aspect-square rounded-lg overflow-hidden mb-2 bg-gray-100">
					{images && images.length > 0 ? (
						<img
							src={images[0][1]}
							alt={title}
							className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
						/>
					) : (
						<div className="w-full h-full bg-gray-200 flex items-center justify-center">
							<span className="text-gray-400 text-xs">No Image</span>
						</div>
					)}
				</div>
				<h4 className="text-xs font-medium truncate">{title}</h4>
				<p className="text-xs text-gray-600">{price ? `${price} sats` : 'Price not set'}</p>
			</div>
		</Link>
	)
}

export function FeaturedUserCard({ userPubkey }: FeaturedUserCardProps) {
	// Ensure userPubkey is a string
	const pubkeyString = userPubkey.toString()

	// Query user's profile
	const { data: profile } = useQuery({
		...profileQueryOptions(nip19.npubEncode(pubkeyString)),
		enabled: !!userPubkey,
	})

	// Query user's products
	const { data: userProductsData, isLoading: isLoadingProducts } = useQuery({
		...productsByPubkeyQueryOptions(pubkeyString),
		enabled: !!userPubkey,
	})

	// Get first 4 products for display
	const userProducts = userProductsData?.slice(0, 4) || []

	// Get user display info
	const displayName = profile?.name || profile?.display_name || nip19.npubEncode(pubkeyString).slice(0, 12) + '...'
	const about = profile?.about
	const picture = profile?.picture

	return (
		<Card className="hover:shadow-lg h-[200px] transition-shadow bg-white">
			<div className="flex items-center space-x-4 h-full">
				{/* Borderless avatar on the left */}
				<div className="flex-shrink-0 h-full aspect-square">
					<Link to="/profile/$profileId" params={{ profileId: pubkeyString }}>
						<img
							src={picture || `https://robohash.org/${pubkeyString}?set=set4&size=80x80`}
							alt={displayName.toString()}
							className="w-full h-full object-cover rounded"
						/>
					</Link>
				</div>

				<div className="flex flex-col justify-between h-full p-4">
					{/* User info in the middle */}
					<div className="flex-1 min-w-0">
						<Link to="/profile/$profileId" params={{ profileId: pubkeyString }} className="block">
							<h3 className="font-semibold text-gray-900 truncate hover:text-blue-600 transition-colors">{displayName}</h3>
							{about && <p className="text-sm text-gray-600 line-clamp-2 mt-1">{about}</p>}
							<p className="text-xs text-gray-500 mt-1">{userProducts.length} products</p>
						</Link>
					</div>

					{/* 2x2 product grid on the right */}
					<div className="flex-shrink-0">
						{isLoadingProducts ? (
							<div className="flex flex-row gap-1">
								{Array.from({ length: 4 }).map((_, index) => (
									<div key={index} className="bg-gray-200 rounded animate-pulse w-9 h-9"></div>
								))}
							</div>
						) : (
							<div className="flex flex-row gap-1">
								{Array.from({ length: 4 }).map((_, index) => {
									const product = userProducts[index]
									if (product) {
										const images = getProductImages(product)
										return (
											<Link key={product.id} to="/products/$productId" params={{ productId: product.id }} className="block">
												<img
													src={images?.[0]?.[1] || '/images/placeholder.png'}
													alt="Product"
													className="w-9 h-9 rounded object-cover hover:opacity-80 transition-opacity"
												/>
											</Link>
										)
									} else {
										return (
											<div key={index} className="w-9 h-9 bg-gray-100 rounded flex items-center justify-center">
												<span className="text-gray-400 text-xs">•</span>
											</div>
										)
									}
								})}
							</div>
						)}
					</div>
				</div>
			</div>
		</Card>
	)
}
