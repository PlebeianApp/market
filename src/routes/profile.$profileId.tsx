import { ItemGrid } from '@/components/ItemGrid'
import { Nip05Badge } from '@/components/Nip05Badge'
import { ProductCard } from '@/components/ProductCard'
import { ProfileName } from '@/components/ProfileName'

import { Button } from '@/components/ui/button'
import { ZapButton } from '@/components/ZapButton'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { getHexColorFingerprintFromHexPubkey, truncateText, userFromIdentifier } from '@/lib/utils'
import { fetchProductsByPubkey, productsByPubkeyQueryOptions } from '@/queries/products'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import type { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, MessageCircle, Minus, Plus, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/profile/$profileId')({
	component: RouteComponent,
})

function RouteComponent() {
	type Params = { profileId: string }
	const params = Route.useParams() as Params
	const [animationParent] = useAutoAnimate()
	const { data: profile } = useSuspenseQuery(profileByIdentifierQueryOptions(params.profileId))
	const [user, setUser] = useState<NDKUser | undefined>(undefined)
	const [showFullAbout, setShowFullAbout] = useState(false)
	const [sellerProducts, setSellerProducts] = useState<NDKEvent[]>([])
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'

	useEffect(() => {
		const fetchUser = async () => {
			const user = await userFromIdentifier(params.profileId)
			if (user) {
				setUser(user)
				const products = await fetchProductsByPubkey(user.pubkey)
				setSellerProducts(products)
			}
		}
		fetchUser()
	}, [params.profileId])

	return (
		<div className="relative text-white min-h-screen">
			<div className="flex flex-col pb-4 relative z-10">
				<div className="relative">
					<Button
						variant="ghost"
						onClick={() => window.history.back()}
						className="absolute top-4 left-4 z-10 flex items-center gap-2 text-white"
					>
						<ArrowLeft className="w-4 h-4" />
						<span>Back</span>
					</Button>

					{profile?.banner ? (
						<div className="w-full aspect-[5/1] overflow-hidden flex items-center justify-center">
							<img src={profile.banner} alt="profile-banner" className="w-full h-full object-cover" />
						</div>
					) : (
						<div
							className="w-full aspect-[5/1] relative overflow-hidden"
							style={{
								background: `linear-gradient(45deg, ${getHexColorFingerprintFromHexPubkey(params.profileId)} 0%, #000 100%)`,
								opacity: 0.8,
							}}
						/>
					)}
				</div>

				{profile?.about && (
					<div ref={animationParent} className="flex flex-row items-center px-8 py-4 bg-zinc-900 text-white text-sm">
						{(() => {
							const aboutTruncated = truncateText(profile.about, 70)
							if (aboutTruncated !== profile.about) {
								return (
									<>
										<p className="break-words">{showFullAbout ? profile.about : aboutTruncated}</p>
										<Button variant="ghost" size="icon" onClick={() => setShowFullAbout(!showFullAbout)}>
											{showFullAbout ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
										</Button>
									</>
								)
							}
							return <p className="break-words">{profile.about}</p>
						})()}
					</div>
				)}

				<div className="flex flex-row justify-between px-8 py-4 bg-black items-center">
					<div className="flex flex-row items-center gap-4">
						{profile?.picture && (
							<img src={profile.picture} alt={profile.name || 'Profile picture'} className="rounded-full w-12 h-12 border-2 border-white" />
						)}
						<div className="flex items-center gap-2">
							<h2 className="text-2xl font-bold text-white">{truncateText(profile?.name ?? 'Unnamed user', isSmallScreen ? 10 : 50)}</h2>
							<Nip05Badge userId={params.profileId} />
						</div>
					</div>
					{!isSmallScreen && (
						<div className="flex gap-2">
							{user && <ZapButton event={user} />}
							<Button variant="focus" size="icon">
								<MessageCircle className="w-5 h-5" />
							</Button>
							<Button variant="secondary" size="icon">
								<Share2 className="w-5 h-5" />
							</Button>
						</div>
					)}
				</div>

				{sellerProducts.length > 0 ? (
					<ItemGrid
						title={
							<div className="flex items-center gap-2">
								<span className="text-2xl font-heading">More products from</span>
								<ProfileName pubkey={user?.pubkey || ''} className="text-2xl font-heading" />
							</div>
						}
					>
						{sellerProducts.map((product) => (
							<ProductCard key={product.id} product={product} />
						))}
					</ItemGrid>
				) : (
					<div className="flex flex-col items-center justify-center h-full">
						<span className="text-2xl font-heading">No products found</span>
					</div>
				)}
			</div>
		</div>
	)
}
