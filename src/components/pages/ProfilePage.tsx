import { PickupLocationDialog } from '@/components/dialogs/PickupLocationDialog'
import { ShareProfileDialog } from '@/components/dialogs/ShareProfileDialog'
import { EntityActionsMenu } from '@/components/EntityActionsMenu'
import { ItemGrid } from '@/components/ItemGrid'
import { Nip05Badge } from '@/components/Nip05Badge'
import { ProductCard } from '@/components/ProductCard'
import { ProfileName } from '@/components/ProfileName'
import { Button } from '@/components/ui/button'
import { ZapButton } from '@/components/social/ZapButton'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useEntityPermissions } from '@/hooks/useEntityPermissions'
import { getHexColorFingerprintFromHexPubkey, truncateText, checkImageLoadable } from '@/lib/utils'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import { addToBlacklist, removeFromBlacklist } from '@/publish/blacklist'
import { addToFeaturedUsers, removeFromFeaturedUsers } from '@/publish/featured'
import { useBlacklistSettings } from '@/queries/blacklist'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedUsers } from '@/queries/featured'
import { productsByPubkeyQueryOptions } from '@/queries/products'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useShippingOptionsByPubkey, getShippingService, getShippingPickupAddress, getShippingTitle } from '@/queries/shipping'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Edit, MapPin, MessageCircle, Minus, Plus, Share2, Timer } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { UserCard } from '../UserCard'
import { TooltipButton } from '../shared/TooltipButton'

interface ProfilePageProps {
	profileId: string
}

export function ProfilePage({ profileId }: ProfilePageProps) {
	const navigate = useNavigate()
	const [animationParent] = useAutoAnimate()

	const { data: profileData } = useSuspenseQuery(profileByIdentifierQueryOptions(profileId))
	const { profile, user } = profileData || {}

	const { data: sellerProducts } = useSuspenseQuery(productsByPubkeyQueryOptions(user?.pubkey || ''))

	const [showFullAbout, setShowFullAbout] = useState(false)
	const [bannerIsLoadable, setBannerIsLoadable] = useState<boolean | null>(null)
	const [shareDialogOpen, setShareDialogOpen] = useState(false)
	const [pickupLocationDialogOpen, setPickupLocationDialogOpen] = useState(false)
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
	const queryClient = useQueryClient()
	const aboutText = profile?.about?.trim() ?? ''
	const hasAbout = aboutText.length > 0
	const truncationLength = isSmallScreen ? 70 : 250
	const aboutTruncated = truncateText(aboutText, truncationLength)
	const shouldTruncateAbout = hasAbout && aboutTruncated !== aboutText
	const isMobile = breakpoint === 'sm' || breakpoint === 'md'

	// Get app config
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey || ''

	// Get entity permissions
	const permissions = useEntityPermissions(user?.pubkey)

	// Get blacklist and featured status
	const { data: blacklistSettings } = useBlacklistSettings(appPubkey)
	const { data: featuredData } = useFeaturedUsers(appPubkey)

	const isBlacklisted = blacklistSettings?.blacklistedPubkeys.includes(user?.pubkey || '') || false
	const isFeatured = featuredData?.featuredUsers.includes(user?.pubkey || '') || false

	// Get vendor's shipping options to check for pickup locations
	const { data: shippingOptions } = useShippingOptionsByPubkey(user?.pubkey || '')

	// Find all pickup shipping options with addresses
	const pickupLocations = useMemo(() => {
		if (!shippingOptions) return []

		const locations: Array<{
			name: string
			address: {
				street: string
				city: string
				state: string
				postalCode: string
				country: string
			}
		}> = []

		for (const option of shippingOptions) {
			const serviceTag = getShippingService(option)
			if (serviceTag && serviceTag[1] === 'pickup') {
				const address = getShippingPickupAddress(option)
				if (address && (address.street || address.city)) {
					locations.push({
						name: getShippingTitle(option),
						address,
					})
				}
			}
		}
		return locations
	}, [shippingOptions])

	// Handle edit profile
	const handleEdit = () => {
		navigate({ to: '/dashboard/account/profile' })
	}

	// Handle add product
	const handleAddProduct = () => {
		productFormActions.reset()
		navigate({ to: '/dashboard/products/draft' })
	}

	// Handle message button
	const handleMessageClick = () => {
		if (user?.pubkey) {
			uiActions.openConversation(user.pubkey)
			console.log('Opening conversation with', user.pubkey)
		}
	}

	// Handle blacklist toggle
	const handleBlacklistToggle = async () => {
		if (!user?.pubkey) return

		const ndk = ndkActions.getNDK()
		if (!ndk?.signer) {
			toast.error('Please connect your wallet first')
			return
		}

		try {
			if (isBlacklisted) {
				await removeFromBlacklist(user.pubkey, ndk.signer, ndk, appPubkey)
				toast.success('User removed from blacklist')
			} else {
				await addToBlacklist(user.pubkey, ndk.signer, ndk, appPubkey)
				toast.success('User added to blacklist')
			}
			// Invalidate blacklist query to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['blacklist'] })
		} catch (error) {
			console.error('Blacklist toggle error:', error)
			toast.error('Failed to update blacklist')
		}
	}

	// Handle featured toggle
	const handleFeaturedToggle = async () => {
		if (!user?.pubkey) return

		const ndk = ndkActions.getNDK()
		if (!ndk?.signer) {
			toast.error('Please connect your wallet first')
			return
		}

		try {
			if (isFeatured) {
				await removeFromFeaturedUsers(user.pubkey, ndk.signer, ndk, appPubkey)
				toast.success('User removed from featured')
			} else {
				await addToFeaturedUsers(user.pubkey, ndk.signer, ndk, appPubkey)
				toast.success('User added to featured')
			}
			// Invalidate featured query to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['featured'] })
		} catch (error) {
			console.error('Featured toggle error:', error)
			toast.error('Failed to update featured status')
		}
	}

	// Check if banner image is loadable
	useEffect(() => {
		const validateBanner = async () => {
			if (profile?.banner) {
				const isLoadable = await checkImageLoadable(profile.banner)
				setBannerIsLoadable(isLoadable)
			} else {
				setBannerIsLoadable(null)
			}
		}
		validateBanner()
	}, [profile?.banner])

	return (
		<div className="relative flex flex-col min-h-screen">
			<div className="top-0 right-0 left-0 z-0 absolute bg-hero-image-margin h-[40vh] sm:h-[40vh] md:h-[50vh] overflow-hidden">
				{profile?.banner && bannerIsLoadable === true ? (
					<div className="-ml-[25%] sm:ml-0 w-[150%] sm:w-full h-full">
						<img src={profile.banner} alt="profile-banner" className="w-full h-full object-cover" />
					</div>
				) : (
					<div
						className="w-full h-full"
						style={{
							background: `linear-gradient(45deg, ${getHexColorFingerprintFromHexPubkey(profileId)} 0%, #000 100%)`,
							opacity: 0.8,
						}}
					/>
				)}
			</div>
			<div className="z-10 relative flex flex-col flex-1 pt-[18vh] sm:pt-[22vh] md:pt-[30vh]">
				<div className="flex flex-row justify-between items-center bg-black px-4 py-4">
					<UserCard pubkey={user?.pubkey ?? ''} className="[&>h2]:text-white" subtitle="npub" onPress="copy-npub" />
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
							{pickupLocations.length > 0 && (
								<TooltipButton
									variant="secondary"
									size="icon"
									tooltip="Set Pickup Location"
									onClick={() => setPickupLocationDialogOpen(true)}
								>
									<MapPin className="size-5" />
								</TooltipButton>
							)}
							<TooltipButton variant="secondary" size="icon" tooltip="Share" onClick={() => setShareDialogOpen(true)}>
								<Share2 className="size-5" />
							</TooltipButton>
							{/* Edit button for profile owner */}
							{permissions.canEdit && (
								<Button variant="secondary" onClick={handleEdit} className="flex items-center gap-2">
									<Edit className="size-5" />
									<span className="hidden md:inline">Edit Profile</span>
								</Button>
							)}
							{/* Entity Actions Menu for admins/editors (blacklist and featured functionality) */}
							<EntityActionsMenu
								permissions={permissions}
								entityType="profile"
								entityId={profileId}
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

				<div
					ref={animationParent}
					className="flex flex-row justify-between items-center bg-zinc-900 px-4 py-4 min-h-[52px] text-white text-xs sm:text-sm"
				>
					{hasAbout ? (
						shouldTruncateAbout ? (
							<>
								<p className="flex-1 break-words">{showFullAbout ? aboutText : aboutTruncated}</p>
								<Button variant="ghost" size="icon" onClick={() => setShowFullAbout(!showFullAbout)}>
									{showFullAbout ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
								</Button>
							</>
						) : (
							<p className="w-full break-words">{aboutText}</p>
						)
					) : (
						<div className="w-full" aria-hidden="true" />
					)}
				</div>

				<div className="flex flex-col flex-1 p-4">
					{sellerProducts && sellerProducts.length > 0 ? (
						<ItemGrid
							title={
								<div className="flex sm:flex-row flex-col sm:items-center sm:gap-2 sm:text-left text-center">
									<span className="font-heading text-2xl">Products from</span>
									<ProfileName pubkey={user?.pubkey || ''} className="font-heading text-2xl" />
								</div>
							}
						>
							{sellerProducts.map((product: NDKEvent) => (
								<ProductCard key={product.id} product={product} />
							))}
						</ItemGrid>
					) : (
						<div className="flex flex-col flex-1 justify-center items-center gap-4">
							<span className="font-heading text-2xl">No products found</span>
							{permissions.canEdit && (
								<Button onClick={handleAddProduct} className="flex items-center gap-2">
									<Plus className="w-5 h-5" />
									Add Your First Product
								</Button>
							)}
						</div>
					)}
				</div>
			</div>

			<ShareProfileDialog
				open={shareDialogOpen}
				onOpenChange={setShareDialogOpen}
				pubkey={user?.pubkey || ''}
				profileName={profile?.name}
			/>

			{pickupLocations.length > 0 && (
				<PickupLocationDialog
					open={pickupLocationDialogOpen}
					onOpenChange={setPickupLocationDialogOpen}
					locations={pickupLocations}
					vendorName={profile?.name}
				/>
			)}
		</div>
	)
}
