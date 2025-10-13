import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile } from '@nostr-dev-kit/ndk'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import { useUpdateProfileMutation } from '@/publish/profiles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { profileByIdentifierQueryOptions, fetchProfileByIdentifier } from '@/queries/profiles'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { profileKeys } from '@/queries/queryKeyFactory'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/profile')({
	component: ProfileComponent,
})

function ProfileComponent() {
	useDashboardTitle('Profile')
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md'
	const ndk = ndkActions.getNDK()
	const pubkey = ndk?.activeUser?.pubkey
	const queryClient = useQueryClient()

	// Fetch profile data with Tanstack Query
	const {
		data: fetchedData,
		isLoading: isLoadingProfile,
		refetch,
	} = useQuery({
		...profileByIdentifierQueryOptions(pubkey || ''),
		enabled: !!pubkey,
	})

	// Trigger metadata loading when component mounts
	useEffect(() => {
		if (pubkey) {
			// Trigger a fresh fetch of the user's metadata
			const loadUserMetadata = async () => {
				try {
					const result = await fetchProfileByIdentifier(pubkey)
					if (result?.profile) {
						// Update the query cache with fresh data
						const queryKey = profileKeys.details(pubkey)
						queryClient.setQueryData(queryKey, result)

						// Also trigger a refetch to ensure UI updates
						refetch()
					}
				} catch (error) {
					console.error('Failed to load metadata:', error)
				}
			}

			loadUserMetadata()
		}
	}, [pubkey, queryClient, refetch])

	// Extract profile from the query result
	const fetchedProfile = fetchedData?.profile

	// Manage local state for profile data
	const [profile, setProfile] = useState<NDKUserProfile>({})
	const [originalProfile, setOriginalProfile] = useState<NDKUserProfile>({})

	// Form state (separate from profile for controlled inputs)
	const [formData, setFormData] = useState({
		name: '',
		displayName: '',
		about: '',
		nip05: '',
		lud16: '',
		lud06: '',
		website: '',
	})

	// Update profile mutation
	const updateProfileMutation = useUpdateProfileMutation()
	const isLoading = isLoadingProfile || updateProfileMutation.isPending

	// Update local state when fetched profile changes
	useEffect(() => {
		if (fetchedProfile) {
			console.log('✅ Profile component received kind 0 metadata:', fetchedProfile)

			// Handle kind 0 metadata field mappings: picture -> image
			const profileWithMappedFields = {
				...fetchedProfile,
				image: fetchedProfile.image || (fetchedProfile as any).picture,
			}
			setProfile(profileWithMappedFields)
			setOriginalProfile(profileWithMappedFields)

			console.log('✅ Profile component processed kind 0 metadata with field mappings:', profileWithMappedFields)

			// Update form data with fetched profile
			// Handle both snake_case (from kind 0 metadata) and camelCase field formats
			setFormData({
				name: fetchedProfile.name || '',
				displayName: fetchedProfile.displayName || (fetchedProfile as any).display_name || '',
				about: fetchedProfile.about || '',
				nip05: fetchedProfile.nip05 || '',
				lud16: fetchedProfile.lud16 || '',
				lud06: fetchedProfile.lud06 || '',
				website: fetchedProfile.website || '',
			})
		}
	}, [fetchedProfile])

	// Handle form submission
	const handleSave = async () => {
		if (!pubkey) {
			toast.error('No active user')
			return
		}

		try {
			const profileData = {
				...formData,
				banner: profile.banner,
				image: profile.image,
			}

			await updateProfileMutation.mutateAsync(profileData)

			// Update original profile after successful save
			const updatedProfile = { ...originalProfile, ...profileData }
			setOriginalProfile(updatedProfile)
			setProfile(updatedProfile)
		} catch (error) {
			// Error handling is done in the mutation
		}
	}

	// Check if mandatory fields are filled
	const areMandatoryFieldsFilled = () => {
		return formData.name.trim() !== '' && formData.displayName.trim() !== ''
	}

	// Check if there are any changes
	const hasChanges = () => {
		// Don't show changes until original profile is loaded
		if (isLoadingProfile || !originalProfile || Object.keys(originalProfile).length === 0) {
			return false
		}

		// Check form field changes
		// Handle both snake_case (from kind 0 metadata) and camelCase field formats
		const originalDisplayName = originalProfile.displayName || (originalProfile as any).display_name || ''
		const formFieldsChanged =
			formData.name !== (originalProfile.name || '') ||
			formData.displayName !== originalDisplayName ||
			formData.about !== (originalProfile.about || '') ||
			formData.nip05 !== (originalProfile.nip05 || '') ||
			formData.lud16 !== (originalProfile.lud16 || '') ||
			formData.lud06 !== (originalProfile.lud06 || '') ||
			formData.website !== (originalProfile.website || '')

		// Check image changes
		// Handle both image and picture field formats from kind 0 metadata
		const originalImage = originalProfile.image || (originalProfile as any).picture
		const imageChanges = profile.banner !== originalProfile.banner || profile.image !== originalImage

		return formFieldsChanged || imageChanges
	}

	const changesExist = hasChanges()
	const mandatoryFieldsFilled = areMandatoryFieldsFilled()

	// Allow saving if mandatory fields are filled, even if no original profile exists yet
	// This handles the case where user is creating a new profile
	const canSave = mandatoryFieldsFilled && (changesExist || Object.keys(originalProfile).length === 0)

	const handleHeaderImageSave = (data: { url: string; index: number }) => {
		setProfile((prev) => ({ ...prev, banner: data.url }))
	}

	const handleProfileImageSave = (data: { url: string; index: number }) => {
		setProfile((prev) => ({ ...prev, image: data.url }))
	}

	const handleImageDelete = (index: number) => {
		if (index === -1) {
			// Handle image deletion here
		}
	}

	if (!pubkey) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Profile</h1>
				<p>Please connect your Nostr account to manage your profile.</p>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Profile</h1>
				<Button
					type="button"
					disabled={isLoading || !canSave}
					onClick={handleSave}
					className="btn-black flex items-center gap-2 px-4 py-2 text-sm font-semibold"
					data-testid="profile-save-button-desktop"
				>
					{isLoading ? 'Saving...' : canSave ? (Object.keys(originalProfile).length === 0 ? 'Create Profile' : 'Save Changes') : 'Saved'}
				</Button>
			</div>
			<div className="space-y-6 p-4 lg:p-8">
				{isLoadingProfile ? (
					<div className="flex items-center justify-center p-8">
						<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					</div>
				) : (
					<div className="space-y-6">
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="headerImage">Header Image</Label>
								<ImageUploader
									src={profile.banner || null}
									index={-1}
									imagesLength={1}
									forSingle={true}
									initialUrl={profile.banner}
									onSave={handleHeaderImageSave}
									onDelete={handleImageDelete}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="profileImage">Profile Image</Label>
								<ImageUploader
									src={profile.image || null}
									index={-1}
									imagesLength={1}
									forSingle={true}
									initialUrl={profile.image}
									onSave={handleProfileImageSave}
									onDelete={handleImageDelete}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="name">
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Name</span>
								</Label>
								<Input
									id="name"
									name="name"
									value={formData.name}
									onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
									placeholder="e.g John Doe"
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="displayName">
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Display Name</span>
								</Label>
								<Input
									id="displayName"
									name="displayName"
									value={formData.displayName}
									onChange={(e) => setFormData((prev) => ({ ...prev, displayName: e.target.value }))}
									placeholder="e.g Bitcoin Merchant"
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="about">About</Label>
								<Textarea
									id="about"
									name="about"
									value={formData.about}
									onChange={(e) => setFormData((prev) => ({ ...prev, about: e.target.value }))}
									placeholder="Write a short bio"
									rows={4}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="nip05">Nostr Address (NIP05)</Label>
								<Input
									id="nip05"
									name="nip05"
									value={formData.nip05}
									onChange={(e) => setFormData((prev) => ({ ...prev, nip05: e.target.value }))}
									placeholder="you@example.com"
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="lud16">Lightning Address (LUD16)</Label>
								<Input
									id="lud16"
									name="lud16"
									value={formData.lud16}
									onChange={(e) => setFormData((prev) => ({ ...prev, lud16: e.target.value }))}
									placeholder="you@walletprovider.com"
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="lud06">LNURL (LUD06)</Label>
								<Input
									id="lud06"
									name="lud06"
									value={formData.lud06}
									onChange={(e) => setFormData((prev) => ({ ...prev, lud06: e.target.value }))}
									placeholder="LNURL..."
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="website">Website</Label>
								<Input
									id="website"
									name="website"
									value={formData.website}
									onChange={(e) => setFormData((prev) => ({ ...prev, website: e.target.value }))}
									placeholder="https://yourwebsite.com"
								/>
							</div>

							<Button
								type="button"
								disabled={isLoading || !canSave}
								className="btn-black w-full lg:hidden"
								onClick={handleSave}
								data-testid="profile-save-button"
							>
								{isLoading
									? 'Saving...'
									: canSave
										? Object.keys(originalProfile).length === 0
											? 'Create Profile'
											: 'Save Changes'
										: 'Saved'}
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
