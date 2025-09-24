import { Header } from '@/components/layout/Header'
import { ItemGrid } from '@/components/ItemGrid'
import { Nip05Badge } from '@/components/Nip05Badge'
import { ProductCard } from '@/components/ProductCard'
import { ProfileName } from '@/components/ProfileName'

import { Button } from '@/components/ui/button'
import { ZapButton } from '@/components/ZapButton'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { getHexColorFingerprintFromHexPubkey, truncateText } from '@/lib/utils'
import { productsByPubkeyQueryOptions } from '@/queries/products'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import type { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, MessageCircle, Minus, Plus, Share2 } from 'lucide-react'
import { useState } from 'react'

export const Route = createFileRoute('/profile/$profileId')({
	component: RouteComponent,
})

function RouteComponent() {
	type Params = { profileId: string }
	const params = Route.useParams() as Params
	const navigate = useNavigate()
	const [animationParent] = useAutoAnimate()

	const { data: profileData } = useSuspenseQuery(profileByIdentifierQueryOptions(params.profileId))
	const { profile, user } = profileData || {}

	const { data: sellerProducts } = useSuspenseQuery(productsByPubkeyQueryOptions(user?.pubkey || ''))

	const [showFullAbout, setShowFullAbout] = useState(false)
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'

	return (
		<div className="relative min-h-screen">
			<Header />
			{/* Header with banner background and dark scrim so image appears underneath the header text */}
			<div className="relative w-full h-40 sm:h-48 md:h-60 overflow-hidden">
				{(() => {
					const bannerUrl = (profile as any)?.banner || (profile as any)?.cover || (profile as any)?.cover_image || ''
					return bannerUrl ? (
						<>
							<img src={bannerUrl} alt="profile-banner" className="absolute inset-0 w-full h-full object-cover" />
							{/* Dark scrim on top of the image to improve text readability under the header text */}
							<div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/20 pointer-events-none" />
						</>
					) : (
						<div
							className="absolute inset-0"
							style={{
								background: `linear-gradient(45deg, ${getHexColorFingerprintFromHexPubkey(params.profileId)} 0%, #000 100%)`,
								opacity: 0.8,
							}}
						/>
					)
				})()}
				<div className="relative z-10 flex flex-row justify-between px-8 py-4 items-center h-full">
					<div className="flex flex-row items-center gap-4">
						{profile?.picture && (
							<img
								src={profile.picture}
								alt={profile.name || 'Profile picture'}
								className="rounded-full w-10 h-10 sm:w-16 sm:h-16 border-2 border-black"
							/>
						)}
						<div className="flex items-center gap-2">
							<h2 className="text-2xl font-bold text-white">{truncateText(profile?.name ?? 'Unnamed user', isSmallScreen ? 10 : 50)}</h2>
							<Nip05Badge userId={user?.npub || ''} />
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
			</div>

				{profile?.about && (
					<div ref={animationParent} className="flex flex-row items-center justify-between px-8 py-4 bg-zinc-900 text-white text-sm">
						{(() => {
							const truncationLength = isSmallScreen ? 70 : 250
							const aboutTruncated = truncateText(profile.about, truncationLength)
							if (aboutTruncated !== profile.about) {
								return (
									<>
										<p className="flex-1 break-words">{showFullAbout ? profile.about : aboutTruncated}</p>
										<Button variant="ghost" size="icon" onClick={() => setShowFullAbout(!showFullAbout)}>
											{showFullAbout ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
										</Button>
									</>
								)
							}
							return <p className="w-full break-words">{profile.about}</p>
						})()}
					</div>
				)}

				<div className="p-4">
					{sellerProducts && sellerProducts.length > 0 ? (
						<ItemGrid
							title={
								<div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-center sm:text-left">
									<span className="text-2xl font-heading">More products from</span>
									<ProfileName pubkey={user?.pubkey || ''} className="text-2xl font-heading" />
								</div>
							}
						>
							{sellerProducts.map((product: NDKEvent) => (
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
