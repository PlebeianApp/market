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
import { nip19 } from 'nostr-tools'

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

	// If we have fetched profile metadata, attach it to the NDKUser so components like ZapButton/ZapDialog
	// can immediately access lud16/lud06 without refetching.
	if (user && profile) {
		;(user as any).profile = (user as any).profile || profile
	}

	// Derive pubkey early when possible (hex or npub). For nip05, wait for profile fetch to provide user.pubkey.
	let immediatePubkey = ''
	try {
		if (params.profileId.startsWith('npub')) {
			const decoded = nip19.decode(params.profileId)
			if (typeof decoded.data === 'string') immediatePubkey = decoded.data
		} else if (!params.profileId.includes('@')) {
			immediatePubkey = params.profileId
		}
	} catch (e) {
		// ignore decode errors; will fall back to user?.pubkey once available
	}

	const pubkeyForProducts = immediatePubkey || user?.pubkey || 'placeholder'

	const { data: sellerProducts = [] } = useSuspenseQuery(
		productsByPubkeyQueryOptions(pubkeyForProducts)
	)

	const [showFullAbout, setShowFullAbout] = useState(false)
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
	// Determine the best display name with proper fallbacks:
	// 1) Prefer profile displayName/display_name or name.
	// 2) If no username-like fields are available, fall back to truncated npub (bech32) derived from pubkey.
	const rawDisplay = profile?.displayName || (profile as any)?.display_name || profile?.name || ''
	const username = profile?.name || ''
	// Compute npub string from available identifiers
	let computedNpub = user?.npub || ''
	try {
		const hex = immediatePubkey || user?.pubkey || ''
		if (!computedNpub && hex) computedNpub = nip19.npubEncode(hex)
	} catch {}
	const fallbackDisplay = computedNpub ? truncateText(computedNpub, isSmallScreen ? 12 : 24) : 'Unnamed user'
	const displayName = rawDisplay || fallbackDisplay
	const lightningAddress = (profile?.lud16 || (profile as any)?.lud06 || '') as string

	return (
		<div className="relative min-h-screen">
			<Header />
			<div className="absolute top-0 left-0 right-0 z-0 h-[40vh] sm:h-[40vh] md:h-[50vh] overflow-hidden">
				{profile?.banner ? (
					<div className="relative w-full h-full">
						<img src={profile.banner} alt="Profile banner" className="w-full h-full object-cover object-center" />
						<div className="absolute inset-0 bg-black/30" />
					</div>
				) : (
					<div
						className="w-full h-full"
						style={{
							background: `linear-gradient(45deg, ${getHexColorFingerprintFromHexPubkey(immediatePubkey || params.profileId)} 0%, #000 100%)`,
							opacity: 0.8,
						}}
					/>
				)}
			</div>
			<div className="flex flex-col relative z-10 pt-[18vh] sm:pt-[22vh] md:pt-[30vh]">
				<div className="flex flex-row justify-between px-8 py-4 bg-black items-center">
					<div className="flex flex-row items-center gap-4">
						{profile?.picture && (
							<img
								src={profile.picture}
								alt={profile.name || 'Profile picture'}
								className="rounded-full w-10 h-10 sm:w-16 sm:h-16 border-2 border-black"
							/>
						)}
						<div className="flex items-center gap-2">
							<div className="flex flex-col">
								<h2 className="text-2xl font-bold text-white">{truncateText(displayName, isSmallScreen ? 10 : 50)}</h2>
								{username && username !== displayName && (
									<span className="text-sm text-zinc-300">@{truncateText(username, isSmallScreen ? 12 : 24)}</span>
								)}
								{lightningAddress && (
									<span className="text-xs text-amber-300 flex items-center gap-1">
										<span className="i-lightning w-4 h-4" />
										{truncateText(lightningAddress, isSmallScreen ? 16 : 40)}
									</span>
								)}
							</div>
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
		</div>
	)
}
