import { EntityActionsMenu } from '@/components/EntityActionsMenu'
import { ItemGrid } from '@/components/ItemGrid'
import { Nip05Badge } from '@/components/Nip05Badge.tsx'
import { ProductCard } from '@/components/ProductCard'
import { Button } from '@/components/ui/button'
import { ZapButton } from '@/components/ZapButton.tsx'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useEntityPermissions } from '@/hooks/useEntityPermissions'
import { ndkActions } from '@/lib/stores/ndk'
import { uiActions, uiStore } from '@/lib/stores/ui'
import { truncateText } from '@/lib/utils.ts'
import { addToBlacklistCollections, removeFromBlacklistCollections } from '@/publish/blacklist'
import { addToFeaturedCollections, removeFromFeaturedCollections } from '@/publish/featured'
import { useBlacklistSettings } from '@/queries/blacklist'
import {
	collectionByIdQueryOptions,
	getCollectionCoordinates,
	getCollectionImages,
	getCollectionSummary,
	getCollectionTitle,
} from '@/queries/collections'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedCollections } from '@/queries/featured'
import { useProductsByCollection } from '@/queries/products'
import { profileByIdentifierQueryOptions, useProfileName } from '@/queries/profiles'
import { useResponsiveBackgroundUrl } from '@/queries/responsive-image'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Edit, MessageCircle, Share2 } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

// Hook to inject dynamic CSS for background image
function useHeroBackground(imageUrl: string, className: string) {
	useEffect(() => {
		if (!imageUrl) return

		const style = document.createElement('style')
		style.textContent = `
      .${className} {
        background-image: url(${imageUrl}) !important;
      }
    `
		document.head.appendChild(style)

		return () => {
			document.head.removeChild(style)
		}
	}, [imageUrl, className])
}

declare module '@tanstack/react-router' {
	interface FileRoutesByPath {
		'/collection/collectionId': {
			loader: (params: { collectionId: string }) => { collectionId: string }
		}
	}
}

export const Route = createFileRoute('/collection/$collectionId')({
	component: RouteComponent,
	loader: ({ params: { collectionId } }) => {
		return { collectionId }
	},
})

function RouteComponent() {
	const { collectionId } = Route.useLoaderData()
	const collectionQuery = useSuspenseQuery(collectionByIdQueryOptions(collectionId))
	const collection = collectionQuery.data

	if (!collection) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4">
				<h1 className="text-2xl font-bold">Collection Not Found</h1>
				<p className="text-gray-600">The collection you're looking for doesn't exist.</p>
			</div>
		)
	}

	const pubkey = collection.pubkey
	const { mobileMenuOpen } = useStore(uiStore)
	const { navigation } = useStore(uiStore)
	const navigate = useNavigate()
	const title = getCollectionTitle(collection)
	const summary = getCollectionSummary(collection)
	type Params = { profileId: string }
	const params = Route.useParams() as Params
	const { data: name, isLoading } = useProfileName(pubkey)
	const { data: profileData } = useSuspenseQuery(profileByIdentifierQueryOptions(pubkey))
	const { profile, user } = profileData || {}
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
	const currentImages = getCollectionImages(collection)
	const { data: products, isLoading: productsLoading } = useProductsByCollection(collection)
	// Use the market image for homepage background
	// const marketBackgroundImageUrl = '/images/market-background.jpg'
	const marketBackgroundImageUrl = currentImages.length > 0 ? currentImages[0][1] : '/images/market-background.jpg'
	const resolvedBackgroundUrl = useResponsiveBackgroundUrl(marketBackgroundImageUrl)
	const marketHeroClassName = 'hero-bg-market'
	// Get background image from current collection, resolved to best responsive variant
	useHeroBackground(resolvedBackgroundUrl, marketHeroClassName)
	const queryClient = useQueryClient()

	// Get app config
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey || ''

	// Get entity permissions
	const permissions = useEntityPermissions(pubkey)

	// Get blacklist and featured status
	const { data: blacklistSettings } = useBlacklistSettings(appPubkey)
	const { data: featuredData } = useFeaturedCollections(appPubkey)

	// Determine if this collection is blacklisted or featured
	const collectionCoords = getCollectionCoordinates(collection)
	const isBlacklisted = blacklistSettings?.blacklistedCollections.includes(collectionCoords) || false
	const isFeatured = featuredData?.featuredCollections.includes(collectionCoords) || false

	// Handle edit collection
	const handleEdit = () => {
		navigate({ to: '/dashboard/products/collections/$collectionId', params: { collectionId } })
	}

	// Handle blacklist toggle
	const handleBlacklistToggle = async () => {
		const ndk = ndkActions.getNDK()
		const signer = ndk?.signer

		if (!ndk || !signer) {
			toast.error('Please connect your wallet to perform this action')
			return
		}

		try {
			if (isBlacklisted) {
				await removeFromBlacklistCollections(collectionCoords, signer, ndk, appPubkey)
				toast.success('Collection removed from blacklist')
			} else {
				await addToBlacklistCollections(collectionCoords, signer, ndk, appPubkey)
				toast.success('Collection added to blacklist')
			}
			// Invalidate queries to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['config', 'blacklist', appPubkey] })
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update blacklist')
		}
	}

	// Handle featured toggle
	const handleFeaturedToggle = async () => {
		const ndk = ndkActions.getNDK()
		const signer = ndk?.signer

		if (!ndk || !signer) {
			toast.error('Please connect your wallet to perform this action')
			return
		}

		try {
			if (isFeatured) {
				await removeFromFeaturedCollections(collectionCoords, signer, ndk, appPubkey)
				toast.success('Collection removed from featured items')
			} else {
				await addToFeaturedCollections(collectionCoords, signer, ndk, appPubkey)
				toast.success('Collection added to featured items')
			}
			// Invalidate queries to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['config', 'featuredCollections', appPubkey] })
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update featured items')
		}
	}

	const handleBackClick = () => {
		if (navigation.originalResultsPath) {
			// Navigate to the original results page
			navigate({ to: navigation.originalResultsPath })
			// Clear all product navigation state
			uiActions.clearProductNavigation()
		} else {
			// Fallback to community page if no source path
			navigate({ to: '/community' })
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="relative z-10">
				{!mobileMenuOpen && (
					<Button variant="ghost" onClick={handleBackClick} className="back-button">
						<ArrowLeft className="h-8 w-8 lg:h-4 lg:w-4" />
						<span className="hidden sm:inline">Back to Community</span>
					</Button>
				)}
				<div className={`relative hero-container-small ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">
						<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-16 lg:mt-0">
							<h1 className="text-2xl font-heading text-center sm:text-left">{title}</h1>
							<div className="flex flex-col items-center justify-center lg:col-span-2 text-md text-white text-center font-medium">
								{summary}
							</div>
						</div>
					</div>
				</div>
				<div className="flex flex-row justify-between px-4 py-2 bg-black items-center">
					<Link to={`/profile/${pubkey}`}>
						<div className="flex flex-row items-center gap-4">
							{profile?.picture && (
								<img
									src={profile.picture}
									alt={profile.name || 'Profile picture'}
									className="rounded-full w-10 h-10 sm:w-8 sm:h-8 border-2 border-black"
								/>
							)}
							<div className="flex items-center gap-2">
								<h2 className="text-1xl font-bold text-white">{truncateText(profile?.name ?? 'Unnamed user', isSmallScreen ? 10 : 50)}</h2>
								<Nip05Badge pubkey={user?.pubkey || ''} showAddress nip05={profile?.nip05} />
							</div>{' '}
						</div>
					</Link>
					{!isSmallScreen && (
						<div className="flex gap-2">
							{user && <ZapButton event={user} />}
							<Button variant="focus" size="icon">
								<MessageCircle className="w-5 h-5" />
							</Button>
							<Button variant="secondary" size="icon">
								<Share2 className="w-5 h-5" />
							</Button>
							{/* Edit button for owner */}
							{permissions.canEdit && (
								<Button variant="secondary" onClick={handleEdit} className="flex items-center gap-2">
									<Edit className="h-5 w-5" />
									<span className="hidden md:inline">Edit Collection</span>
								</Button>
							)}
							{/* Entity Actions Menu for admins/editors/owners */}
							<EntityActionsMenu
								permissions={permissions}
								entityType="collection"
								entityId={collectionId}
								entityCoords={collectionCoords}
								isBlacklisted={isBlacklisted}
								isFeatured={isFeatured}
								onEdit={permissions.canEdit ? handleEdit : undefined}
								onBlacklist={permissions.canBlacklist && !isBlacklisted ? handleBlacklistToggle : undefined}
								onUnblacklist={permissions.canBlacklist && isBlacklisted ? handleBlacklistToggle : undefined}
								onSetFeatured={permissions.canSetFeatured && !isFeatured ? handleFeaturedToggle : undefined}
								onUnsetFeatured={permissions.canSetFeatured && isFeatured ? handleFeaturedToggle : undefined}
							/>
						</div>
					)}
				</div>

				<div className="p-4">
					{productsLoading ? (
						<div className="flex flex-col items-center justify-center h-full">
							<span className="text-xl">Loading products...</span>
						</div>
					) : products && products.length > 0 ? (
						<ItemGrid
						// title={
						// 	<div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-center sm:text-left">
						// 		<span className="text-2xl font-heading">Products in collection</span>
						// 		{/*<ProfileName pubkey={user?.pubkey || ''} className="text-2xl font-heading" />*/}
						// 	</div>
						// }
						>
							{products?.map((product: NDKEvent) => (
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
