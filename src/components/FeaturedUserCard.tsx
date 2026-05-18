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

interface FeaturedUserCardProps extends React.HTMLAttributes<'div'> {
	userPubkey: string
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
		<Card className="hover:shadow-lg h-50 transition-shadow bg-background overflow-hidden py-0">
			<div className="flex h-full">
				{/* Avatar on the left */}
				<div className="shrink-0 w-50 h-full">
					<Link to="/profile/$profileId" params={{ profileId: pubkeyString }}>
						<img
							src={picture || `https://robohash.org/${pubkeyString}?set=set4&size=200x200`}
							alt={displayName.toString()}
							className="w-full h-full object-cover"
						/>
					</Link>
				</div>

				{/* User info and products */}
				<div className="flex flex-col justify-between  p-4 min-w-0">
					{/* User info */}
					<div className="flex-1 min-w-0">
						<Link to="/profile/$profileId" params={{ profileId: pubkeyString }} className="block">
							<h3 className="font-semibold text-foreground/90 truncate hover:text-blue-600 transition-colors">{displayName}</h3>
							{about && <p className="text-sm text-foreground/80 line-clamp-2 mt-1">{about}</p>}
							<p className="text-xs text-foreground/70 mt-1">{userProducts.length} products</p>
						</Link>
					</div>

					{/* Product grid at the bottom */}
					<div className="shrink-0 mt-2">
						{isLoadingProducts ? (
							<div className="flex flex-row gap-1">
								{Array.from({ length: 4 }).map((_, index) => (
									<div key={index} className="bg-background/80 rounded animate-pulse w-12 h-12"></div>
								))}
							</div>
						) : (
							<div className="flex flex-row gap-1">
								{Array.from({ length: 4 }).map((_, index) => {
									const product = userProducts[index]
									if (product) {
										const images = getProductImages(product)
										return (
											<Link key={product.id} to="/product/$productId" params={{ productId: product.id }} className="block">
												<img
													src={images?.[0]?.[1] || '/images/placeholder.png'}
													alt="Product"
													className="w-12 h-12 rounded object-cover hover:opacity-80 transition-opacity"
												/>
											</Link>
										)
									} else {
										return (
											<div key={index} className="w-12 h-12 bg-background/90 rounded flex items-center justify-center">
												<span className="text-foreground/70 text-xs">•</span>
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
