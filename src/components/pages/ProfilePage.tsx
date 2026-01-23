import { ShareProfileDialog } from '@/components/dialogs/ShareProfileDialog'
import { EntityActionsMenu } from '@/components/EntityActionsMenu'
import { ItemGrid } from '@/components/ItemGrid'
import { Nip05Badge } from '@/components/Nip05Badge'
import { ProductCard } from '@/components/ProductCard'
import { ProfileName } from '@/components/ProfileName'
import { Button } from '@/components/ui/button'
import { ZapButton } from '@/components/ZapButton'
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
import { useAutoAnimate } from '@formkit/auto-animate/react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Edit, MessageCircle, Minus, Plus, Share2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'

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
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
	const queryClient = useQueryClient()
	const aboutText = profile?.about?.trim() ?? ''
	const hasAbout = aboutText.length > 0
	const truncationLength = isSmallScreen ? 70 : 250
	const aboutTruncated = truncateText(aboutText, truncationLength)
	const shouldTruncateAbout = hasAbout && aboutTruncated !== aboutText

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
		<div className="relative min-h-screen flex flex-col">
			<div className="absolute top-0 left-0 right-0 z-0 h-[40vh] sm:h-[40vh] md:h-[50vh] overflow-hidden">
				{profile?.banner && bannerIsLoadable === true ? (
					<div className="w-[150%] sm:w-full h-full -ml-[25%] sm:ml-0">
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
			<div className="flex flex-col relative z-10 pt-[18vh] sm:pt-[22vh] md:pt-[30vh] flex-1">
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
							<h2 className="text-xl sm:text-2xl font-bold text-white">
								{truncateText(profile?.name ?? 'Unnamed user', isSmallScreen ? 28 : 50)}
							</h2>
							<Nip05Badge pubkey={user?.pubkey || ''} showAddress nip05={profile?.nip05} />
						</div>
					</div>
					{!isSmallScreen && (
						<div className="flex gap-2">
							{user && <ZapButton event={user} />}
							<Button variant="focus" size="icon" onClick={handleMessageClick}>
								<MessageCircle className="w-5 h-5" />
							</Button>
							<Button variant="secondary" size="icon" onClick={() => setShareDialogOpen(true)}>
								<Share2 className="w-5 h-5" />
							</Button>
							{/* Edit button for profile owner */}
							{permissions.canEdit && (
								<Button variant="secondary" onClick={handleEdit} className="flex items-center gap-2">
									<Edit className="h-5 w-5" />
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
					className="flex flex-row items-center justify-between px-8 py-4 bg-zinc-900 text-white text-xs sm:text-sm min-h-[52px]"
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

				<div className="p-4 flex-1 flex flex-col">
					{sellerProducts && sellerProducts.length > 0 ? (
						<ItemGrid
							title={
								<div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-center sm:text-left">
									<span className="text-2xl font-heading">Products from</span>
									<ProfileName pubkey={user?.pubkey || ''} className="text-2xl font-heading" />
								</div>
							}
						>
							{sellerProducts.map((product: NDKEvent) => (
								<ProductCard key={product.id} product={product} />
							))}
						</ItemGrid>
					) : (
						<div className="flex flex-col items-center justify-center flex-1 gap-4">
							<span className="text-2xl font-heading">No products found</span>
							{permissions.canEdit && (
								<Button onClick={handleAddProduct} className="flex items-center gap-2">
									<Plus className="h-5 w-5" />
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
		</div>
	)
}
