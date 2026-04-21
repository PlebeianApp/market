import { EntityActionsMenu } from '@/components/EntityActionsMenu'
import { ItemGrid } from '@/components/ItemGrid'
import { Nip05Badge } from '@/components/Nip05Badge.tsx'
import { ProductCard } from '@/components/ProductCard'
import { Button } from '@/components/ui/button'
import { UserCard } from '@/components/UserCard'
import { ZapButton } from '@/components/social/ZapButton'
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
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Edit, MessageCircle, Share2 } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { TooltipButton } from '@/components/shared/TooltipButton'

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
			<div className="flex flex-col justify-center items-center gap-4 h-[50vh]">
				<h1 className="font-bold text-2xl">Collection Not Found</h1>
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
	const marketHeroClassName = 'hero-bg-market'
	// Get background image from current collection (only if not homepage slide)
	useHeroBackground(marketBackgroundImageUrl, marketHeroClassName)
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
	// Handle message button
	const handleMessageClick = () => {
		if (user?.pubkey) {
			uiActions.openConversation(user.pubkey)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="z-10 relative">
				{!mobileMenuOpen && (
					<Button variant="ghost" onClick={handleBackClick} className="back-button">
						<ArrowLeft className="w-8 lg:w-4 h-8 lg:h-4" />
						<span className="hidden sm:inline">Back to Community</span>
					</Button>
				)}
				<div className={`relative hero-container-small ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="z-10 absolute inset-0 bg-radial-overlay" />
						<div className="z-10 absolute inset-0 bg-dots-overlay opacity-30" />
					</div>

					<div className="hero-content">
						<div className="z-20 relative flex flex-col justify-center items-center lg:col-span-2 mt-16 lg:mt-0 text-white text-center">
							<h1 className="font-heading text-2xl sm:text-left text-center">{title}</h1>
							<div className="flex flex-col justify-center items-center lg:col-span-2 font-medium text-md text-white text-center">
								{summary}
							</div>
						</div>
					</div>
				</div>
				<div className="flex flex-row justify-between items-center bg-black px-4 py-2">
					<UserCard pubkey={pubkey} size="md" className="[&>h2]:text-white" />
					{!isSmallScreen && (
						<div className="flex gap-2">
							{user && <ZapButton event={user} />}
							<TooltipButton
								variant="outline"
								size="icon"
								tooltip="Message"
								onClick={handleMessageClick}
								className="bg-transparent hover:bg-background border-2 border-background rounded text-background hover:text-foreground"
							>
								<MessageCircle className="size-5" />
							</TooltipButton>
							<Button variant="secondary" size="icon">
								<Share2 className="w-5 h-5" />
							</Button>
							{/* Edit button for owner */}
							{permissions.canEdit && (
								<Button variant="secondary" onClick={handleEdit} className="flex items-center gap-2">
									<Edit className="w-5 h-5" />
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
						<div className="flex flex-col justify-center items-center h-full">
							<span className="text-xl">Loading products...</span>
						</div>
					) : products && products.length > 0 ? (
						<ItemGrid
						// title={
						// 	<div className="flex sm:flex-row flex-col sm:items-center sm:gap-2 sm:text-left text-center">
						// 		<span className="font-heading text-2xl">Products in collection</span>
						// 		{/*<ProfileName pubkey={user?.pubkey || ''} className="font-heading text-2xl" />*/}
						// 	</div>
						// }
						>
							{products?.map((product: NDKEvent) => (
								<ProductCard key={product.id} product={product} />
							))}
						</ItemGrid>
					) : (
						<div className="flex flex-col justify-center items-center h-full">
							<span className="font-heading text-2xl">No products found</span>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
