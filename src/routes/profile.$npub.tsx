import { Nip05Badge } from '@/components/Nip05Badge'

import { Button } from '@/components/ui/button'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { getHexColorFingerprintFromHexPubkey, truncateText } from '@/lib/utils'
import { profileQueryOptions } from '@/queries/profiles'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, MessageCircle, Minus, Plus, Share2, Zap } from 'lucide-react'
import { useState } from 'react'

interface ProductCollection {
	id: string
	name: string
	description?: string
	image?: string
	owner?: string
	currency?: string
}

interface Product {
	id: string
	name: string
	image?: string
	price?: number
	currency?: string
	stall_id?: string
}

export const Route = createFileRoute('/profile/$npub')({
	component: RouteComponent,
})

function RouteComponent() {
	type Params = { npub: string }
	const params = Route.useParams() as Params
	const [animationParent] = useAutoAnimate()
	const { data: profile } = useSuspenseQuery(profileQueryOptions(params.npub))
	const [showFullAbout, setShowFullAbout] = useState(false)
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'

	const stalls: ProductCollection[] = [
		{
			id: '1',
			name: 'HODLR.ROCKS',
			description: 'Laser cut bitcoin, nostr and freedom tech art',
			owner: params.npub,
			currency: 'GBP',
		},
	]
	const products: Product[] = []

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
								background: `linear-gradient(45deg, ${getHexColorFingerprintFromHexPubkey(params.npub)} 0%, #000 100%)`,
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
							<Nip05Badge userId={params.npub} />
						</div>
					</div>
					{!isSmallScreen && (
						<div className="flex gap-2">
							<Button variant="primary" size="icon">
								<Zap className="w-5 h-5" />
							</Button>
							<Button variant="focus" size="icon">
								<MessageCircle className="w-5 h-5" />
							</Button>
							<Button variant="secondary" size="icon">
								<Share2 className="w-5 h-5" />
							</Button>
						</div>
					)}
				</div>

				<div className="px-8 py-6">
					<h3 className="text-2xl font-bold mb-6 uppercase">Shops</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{stalls.map((stall) => (
							<div key={stall.id} className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900">
								<div className="aspect-video bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center">
									{stall.image ? (
										<img src={stall.image} alt={stall.name} className="w-full h-full object-cover" />
									) : (
										<span className="text-2xl font-bold">{stall.name}</span>
									)}
								</div>
								<div className="p-4">
									<h4 className="text-xl font-bold">{stall.name}</h4>
									{stall.description && <p className="text-sm text-gray-400 mt-2">{stall.description}</p>}
									<div className="mt-4 pt-4 border-t border-zinc-800 flex justify-between">
										<div className="text-sm">
											<div>
												Currency: <span className="font-bold">{stall.currency}</span>
											</div>
											<div>
												Owner: <span className="font-bold">{truncateText(profile?.name || 'Anonymous', 15)}</span>
											</div>
										</div>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>

				{products.length > 0 && (
					<div className="px-8 py-6">
						<h3 className="text-2xl font-bold mb-6 uppercase">Products</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
							{products.map((product) => (
								<div key={product.id} className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900">
									<div className="aspect-square bg-gradient-to-r from-zinc-800 to-zinc-900 flex items-center justify-center">
										{product.image ? (
											<img src={product.image} alt={product.name} className="w-full h-full object-cover" />
										) : (
											<span className="text-lg font-bold">{product.name}</span>
										)}
									</div>
									<div className="p-4">
										<h4 className="text-lg font-bold">{product.name}</h4>
										{product.price && (
											<p className="text-sm font-bold text-yellow-500 mt-2">
												{product.price} {product.currency}
											</p>
										)}
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
