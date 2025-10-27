import { EntityActionsMenu } from '@/components/EntityActionsMenu'
import { ItemGrid } from '@/components/ItemGrid'
import { Header } from '@/components/layout/Header'
import { Nip05Badge } from '@/components/Nip05Badge'
import { ProductCard } from '@/components/ProductCard'
import { ProfileName } from '@/components/ProfileName'

import { Button } from '@/components/ui/button'
import { ZapButton } from '@/components/ZapButton'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useEntityPermissions } from '@/hooks/useEntityPermissions'
import { getHexColorFingerprintFromHexPubkey, truncateText } from '@/lib/utils'
import { ndkActions } from '@/lib/stores/ndk'
import { addToBlacklist, removeFromBlacklist } from '@/publish/blacklist'
import { addToFeaturedUsers, removeFromFeaturedUsers } from '@/publish/featured'
import { useBlacklistSettings } from '@/queries/blacklist'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedUsers } from '@/queries/featured'
import { productsByPubkeyQueryOptions } from '@/queries/products'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Edit, MessageCircle, Minus, Plus, Share2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { getProfileFromLocalStorage } from '@/lib/utils/profileStorage'

export const Route = createFileRoute('/profile/$profileId')({
	component: RouteComponent,
	loader: ({ params }) => {
		// Pre-load profile data to avoid suspense issues
		return { profileId: params.profileId }
	},
})

function RouteComponent() {
	type Params = { profileId: string }
	const params = Route.useParams() as Params
	const navigate = useNavigate()
	const [animationParent] = useAutoAnimate()

	// Local state for profile data as fallback
	const [localProfile, setLocalProfile] = useState<any>(null)

	// Load profile from localStorage when profileId changes
	useEffect(() => {
		if (params.profileId) {
			const cachedProfile = getProfileFromLocalStorage(params.profileId)
			if (cachedProfile) {
				setLocalProfile({ profile: cachedProfile, user: null })
			}
		} else {
			setLocalProfile(null)
		}
	}, [params.profileId])

	const { data: profileData, isLoading: isLoadingProfile } = useQuery({
		...profileByIdentifierQueryOptions(params.profileId),
		enabled: !!params.profileId,
		staleTime: 5 * 60 * 1000, // 5 minutes
		initialData: () => {
			// Try to load from localStorage first for immediate display
			if (params.profileId) {
				const profile = getProfileFromLocalStorage(params.profileId)
				if (profile) {
					return { profile, user: null }
				}
			}
			return undefined
		},
		refetchOnWindowFocus: false,
		refetchOnMount: true,
	})

	// Use query data if available, otherwise fall back to localStorage
	const finalProfileData = profileData || localProfile
	const { profile, user } = finalProfileData || {}

	const { data: sellerProducts, isLoading: isLoadingProducts } = useQuery({
		...productsByPubkeyQueryOptions(user?.pubkey || ''),
		enabled: !!user?.pubkey,
	})

	const [showFullAbout, setShowFullAbout] = useState(false)
	const breakpoint = useBreakpoint()
	const isSmallScreen = breakpoint === 'sm'
	const queryClient = useQueryClient()

	// Get app config
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey || ''

	// Get entity permissions - use the profileId from URL params, not user?.pubkey
	const permissions = useEntityPermissions(params.profileId)

	// Debug logging for profile page
	if (process.env.NODE_ENV === 'development') {
		console.log('🔍 Profile Page state:', {
			profileId: params.profileId,
			profileData,
			localProfile,
			finalProfileData,
			profile,
			user,
			hasProfile: !!profile,
			profileKeys: profile ? Object.keys(profile) : [],
			isLoading: isLoadingProfile,
			permissions: {
				canEdit: permissions.canEdit,
				isEntityOwner: permissions.isEntityOwner,
				userRole: permissions.userRole,
				currentUserPubkey: permissions.currentUserPubkey?.slice(0, 8) + '...',
			},
			editButtonChecks: {
				isSmallScreen,
				permissionsCanEdit: permissions.canEdit,
				shouldShowDesktopButton: !isSmallScreen && permissions.canEdit,
				shouldShowMobileButton: isSmallScreen && permissions.canEdit,
				profileIdVsAuthPubkey: {
					profileId: params.profileId,
					authPubkey: permissions.currentUserPubkey,
					matches: params.profileId === permissions.currentUserPubkey,
				},
			},
		})
	}

	// Get blacklist and featured status
	const { data: blacklistSettings } = useBlacklistSettings(appPubkey)
	const { data: featuredData } = useFeaturedUsers(appPubkey)

	const isBlacklisted = blacklistSettings?.blacklistedPubkeys.includes(user?.pubkey || '') || false
	const isFeatured = featuredData?.featuredUsers.includes(user?.pubkey || '') || false

	// Handle edit profile
	const handleEdit = () => {
		navigate({ to: '/dashboard/account/profile' })
	}

	// Handle blacklist toggle
	const handleBlacklistToggle = async () => {
		const ndk = ndkActions.getNDK()
		const signer = ndk?.signer

		if (!ndk || !signer) {
			toast.error('Please connect your wallet to perform this action')
			return
		}

		if (!user?.pubkey) {
			toast.error('Invalid user pubkey')
			return
		}

		try {
			if (isBlacklisted) {
				await removeFromBlacklist(user.pubkey, signer, ndk, appPubkey)
				toast.success('User removed from blacklist')
			} else {
				await addToBlacklist(user.pubkey, signer, ndk, appPubkey)
				toast.success('User added to blacklist')
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

		if (!user?.pubkey) {
			toast.error('Invalid user pubkey')
			return
		}

		try {
			if (isFeatured) {
				await removeFromFeaturedUsers(user.pubkey, signer, ndk, appPubkey)
				toast.success('User removed from featured')
			} else {
				await addToFeaturedUsers(user.pubkey, signer, ndk, appPubkey)
				toast.success('User added to featured')
			}
			// Invalidate queries to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['config', 'featuredUsers', appPubkey] })
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update featured users')
		}
	}

	// Show loading state if no profile data is available
	if (isLoadingProfile && !profile) {
		return (
			<div className="relative min-h-screen">
				<Header />
				<div className="flex items-center justify-center h-96">
					<div className="text-center">
						<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
						<p className="text-white">Loading profile...</p>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="relative min-h-screen">
			<Header />
			<div className="absolute top-0 left-0 right-0 z-0 h-[40vh] sm:h-[40vh] md:h-[50vh] overflow-hidden">
				{profile?.banner ? (
					<div className="w-[150%] sm:w-full h-full -ml-[25%] sm:ml-0">
						<img src={profile.banner} alt="profile-banner" className="w-full h-full object-cover" />
					</div>
				) : (
					<div
						className="w-full h-full"
						style={{
							background: `linear-gradient(45deg, ${getHexColorFingerprintFromHexPubkey(params.profileId)} 0%, #000 100%)`,
							opacity: 0.8,
						}}
					/>
				)}
			</div>
			<div className="flex flex-col relative z-10 pt-[18vh] sm:pt-[22vh] md:pt-[30vh]">
				<div className="flex flex-row justify-between px-8 py-4 bg-black items-center">
					<div className="flex flex-row items-center gap-4">
						{(profile?.image || profile?.picture) && (
							<img
								src={profile.image || profile.picture}
								alt={profile.name || 'Profile picture'}
								className="rounded-full w-10 h-10 sm:w-16 sm:h-16 border-2 border-black"
							/>
						)}
						<div className="flex items-center gap-2">
							<h2 className="text-2xl font-bold text-white">{truncateText(profile?.name ?? 'Unnamed user', isSmallScreen ? 10 : 50)}</h2>
							<Nip05Badge pubkey={user?.pubkey || ''} />
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
								entityId={params.profileId}
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
					{/* Mobile edit button */}
					{isSmallScreen && permissions.canEdit && (
						<div className="px-8 py-2">
							<Button variant="secondary" onClick={handleEdit} className="w-full flex items-center justify-center gap-2">
								<Edit className="h-4 w-4" />
								<span>Edit Profile</span>
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
