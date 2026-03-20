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
import { useQuery } from '@tanstack/react-query'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { Store, User, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useAllShopProfiles, usePublishShopProfileMutation, type ShopProfile, createEmptyShopProfile } from '@/queries/shopProfile'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/profile')({
	component: ProfileComponent,
})

// Collapsible Section
function SectionHeader({
	icon: Icon,
	title,
	subtitle,
	open,
	onToggle,
	accent,
}: {
	icon: React.ElementType
	title: string
	subtitle: string
	open: boolean
	onToggle: () => void
	accent: 'pink' | 'purple'
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors text-left
				${accent === 'pink' ? 'border-pink-200 bg-pink-50 hover:bg-pink-100' : 'border-purple-200 bg-purple-50 hover:bg-purple-100'}`}
		>
			<div className="flex items-center gap-3">
				<div className={`p-1.5 rounded-md ${accent === 'pink' ? 'bg-pink-500 text-white' : 'bg-purple-500 text-white'}`}>
					<Icon className="w-4 h-4" />
				</div>
				<div>
					<p className="font-semibold text-sm text-gray-900">{title}</p>
					<p className="text-xs text-gray-500">{subtitle}</p>
				</div>
			</div>
			{open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
		</button>
	)
}

function ProfileComponent() {
	useDashboardTitle('Profile')
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md'
	const ndk = ndkActions.getNDK()
	const pubkey = ndk?.activeUser?.pubkey

	// Fetch profile data with Tanstack Query
	const { data: fetchedData, isLoading: isLoadingProfile } = useQuery({
		...profileByIdentifierQueryOptions(pubkey || ''),
		enabled: !!pubkey,
	})
	const { data: allStalls = [], isLoading: isLoadingShop } = useAllShopProfiles(pubkey)
	const [activeStallId, setActiveStallId] = useState<string | null>(null)
	const fetchedShopProfile = activeStallId ? (allStalls.find((s) => s.id === activeStallId) ?? null) : null

	const [shopForm, setShopForm] = useState({ name: '', description: '', currency: 'SATS', location: '' })
	const [shopImages, setShopImages] = useState<{ banner?: string; picture?: string }>({})
	const [originalShopForm, setOriginalShopForm] = useState<typeof shopForm | null>(null)
	const [originalShopImages, setOriginalShopImages] = useState<typeof shopImages>({})
	const [personalOpen, setPersonalOpen] = useState(false)
	const [shopOpen, setShopOpen] = useState(false)
	const [isCreatingNew, setIsCreatingNew] = useState(false)
	const publishShopMutation = usePublishShopProfileMutation()

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

	useEffect(() => {
		if (allStalls.length > 0 && !activeStallId && !isCreatingNew) {
			setActiveStallId(allStalls[0].id)
		}
	}, [allStalls, activeStallId, isCreatingNew])

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

	useEffect(() => {
		if (fetchedShopProfile && fetchedShopProfile.id === activeStallId) {
			const form = {
				name: fetchedShopProfile.name || '',
				description: fetchedShopProfile.description || '',
				currency: fetchedShopProfile.currency || 'SATS',
				location: fetchedShopProfile.location || '',
			}
			setShopForm(form)
			setShopImages({ banner: fetchedShopProfile.banner, picture: fetchedShopProfile.picture })
			setOriginalShopForm(form)
			setOriginalShopImages({ banner: fetchedShopProfile.banner, picture: fetchedShopProfile.picture })
		}
	}, [fetchedShopProfile, activeStallId])

	// Handle form submission
	const handleSavePersonal = async () => {
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

	const handleSaveShop = async () => {
		if (!shopForm.name.trim()) return toast.error('Shop name is required')
		const shopProfile: ShopProfile = {
			id: fetchedShopProfile?.id ?? uuidv4(),
			name: shopForm.name.trim(),
			description: shopForm.description.trim(),
			currency: shopForm.currency || 'SATS',
			location: shopForm.location.trim() || undefined,
			banner: shopImages.banner,
			picture: shopImages.picture,
			shipping: fetchedShopProfile?.shipping ?? [],
		}
		try {
			await publishShopMutation.mutateAsync(shopProfile)
			toast.success('Shop profile saved!')
			setOriginalShopForm({ ...shopForm })
			setOriginalShopImages({ ...shopImages })
			setIsCreatingNew(false)
			setActiveStallId(shopProfile.id)
		} catch (e: any) {
			toast.error(e?.message || 'Failed to publish shop profile')
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

	const shopHasChanges = () => {
		if (!originalShopForm) return shopForm.name.trim() !== ''
		return (
			shopForm.name !== originalShopForm.name ||
			shopForm.description !== originalShopForm.description ||
			shopForm.location !== originalShopForm.location ||
			shopForm.currency !== originalShopForm.currency ||
			shopImages.banner !== originalShopImages.banner ||
			shopImages.picture !== originalShopImages.picture
		)
	}
	const canSaveShop = shopHasChanges() && shopForm.name.trim() !== ''

	const changesExist = hasChanges()
	const mandatoryFieldsFilled = areMandatoryFieldsFilled()

	// Allow saving if mandatory fields are filled, even if no original profile exists yet
	// This handles the case where user is creating a new profile
	const canSavePersonal = mandatoryFieldsFilled && (changesExist || Object.keys(originalProfile).length === 0)

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
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={isLoading || !canSavePersonal}
						onClick={handleSavePersonal}
						className="flex items-center gap-2 text-sm font-semibold"
						data-testid="personal-save-button-desktop"
					>
						<User className="w-4 h-4" />
						{updateProfileMutation.isPending ? 'Saving...' : canSavePersonal ? 'Save Personal' : 'Personal Saved'}
					</Button>
					<Button
						type="button"
						disabled={isLoading || !canSaveShop}
						onClick={handleSaveShop}
						className="btn-black flex items-center gap-2 text-sm font-semibold"
						data-testid="shop-save-button-desktop"
					>
						<Store className="w-4 h-4" />
						{publishShopMutation.isPending ? 'Saving...' : canSaveShop ? 'Save Shop Profile' : 'Shop Saved'}
					</Button>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-8">
				{isLoadingProfile || isLoadingShop ? (
					<div className="flex items-center justify-center p-8">
						<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					</div>
				) : (
					<div className="space-y-6">
						<div className="flex gap-2 items-start p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
							<Info className="w-4 h-4 mt-0.5 shrink-0" />
							<span>
								<strong>Personal Profile</strong> updates your Nostr identity (kind 0). <strong>Shop Profile</strong> creates a separate
								marketplace identity (NIP-15 stall) — your shop visitors will see shop details instead of your personal profile.
							</span>
						</div>
						<div className="space-y-4">
							<SectionHeader
								icon={User}
								title="Personal Profile"
								subtitle="Your Nostr identity, synced across all Nostr apps"
								open={personalOpen}
								onToggle={() => setPersonalOpen((v) => !v)}
								accent="pink"
							/>
							{personalOpen && (
								<div className="space-y-4 pl-1">
									<div className="space-y-2">
										<Label htmlFor="headerImage">
											Header Image <span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
										<ImageUploader
											src={profile.banner || null}
											index={-1}
											imagesLength={1}
											forSingle={true}
											initialUrl={profile.banner}
											onSave={handleHeaderImageSave}
											onDelete={handleImageDelete}
											imageDimensionText="dimensions: 2000px High x 400px Wide"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="profileImage">
											Profile Image <span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
										<ImageUploader
											src={profile.image || null}
											index={-1}
											imagesLength={1}
											forSingle={true}
											initialUrl={profile.image}
											onSave={handleProfileImageSave}
											onDelete={handleImageDelete}
											imageDimensionText="dimensions: 200px High x 200px Wide"
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
										<Label htmlFor="about">
											About <span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
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
										<Label htmlFor="nip05">
											Nostr Address (NIP05) <span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
										<Input
											id="nip05"
											name="nip05"
											value={formData.nip05}
											onChange={(e) => setFormData((prev) => ({ ...prev, nip05: e.target.value }))}
											placeholder="you@example.com"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="lud16">
											Lightning Address (LUD16) <span className="text-muted-foreground font-normal">(optional)</span>
											<div className="text-xs text-muted-foreground mt-1 font-normal">
												Recommended wallets: (
												<a href="https://coinos.io" target="_blank" rel="noopener noreferrer" className="underline hover:text-pink-500">
													CoinOS
												</a>
												,{' '}
												<a href="https://primal.net" target="_blank" rel="noopener noreferrer" className="underline hover:text-pink-500">
													Primal
												</a>
												,{' '}
												<a href="https://lnbits.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-pink-500">
													LNBits
												</a>
												,{' '}
												<a href="https://minibits.cash" target="_blank" rel="noopener noreferrer" className="underline hover:text-pink-500">
													Minibits
												</a>
												,{' '}
												<a
													href="https://app.mutinywallet.com/setup"
													target="_blank"
													rel="noopener noreferrer"
													className="underline hover:text-pink-500"
												>
													Mutiny
												</a>
												,{' '}
												<a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-pink-500">
													Alby
												</a>
												)
											</div>
										</Label>
										<Input
											id="lud16"
											name="lud16"
											value={formData.lud16}
											onChange={(e) => setFormData((prev) => ({ ...prev, lud16: e.target.value }))}
											placeholder="you@walletprovider.com"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="lud06">
											LNURL (LUD06) <span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
										<Input
											id="lud06"
											name="lud06"
											value={formData.lud06}
											onChange={(e) => setFormData((prev) => ({ ...prev, lud06: e.target.value }))}
											placeholder="LNURL..."
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="website">
											Website <span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
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
										disabled={isLoading || !canSavePersonal}
										className="btn-black w-full lg:hidden"
										onClick={handleSavePersonal}
										data-testid="profile-save-button"
									>
										{isLoading
											? 'Saving...'
											: canSavePersonal
												? Object.keys(originalProfile).length === 0
													? 'Create Profile'
													: 'Save Changes'
												: 'Saved'}
									</Button>
								</div>
							)}
						</div>
						<div className="space-y-4">
							{allStalls.length > 0 && (
								<div className="flex flex-wrap gap-2">
									{allStalls.map((stall) => (
										<button
											key={stall.id}
											type="button"
											onClick={() => {
												setActiveStallId(stall.id)
												setIsCreatingNew(false)
											}}
											className={`px-3 py-1.5 rounded-full text-sm border transition-colors
                     ${
												activeStallId === stall.id
													? 'bg-purple-500 text-white border-purple-500'
													: 'border-gray-300 hover:border-purple-400 text-gray-700'
											}`}
										>
											{stall.name || 'Unnamed stall'}
										</button>
									))}
									<button
										type="button"
										onClick={() => {
											setActiveStallId(null)
											setIsCreatingNew(true)
											setShopForm({ name: '', description: '', currency: 'SATS', location: '' })
											setShopImages({})
											setOriginalShopForm(null)
											setOriginalShopImages({})
											setShopOpen(true)
										}}
										className="px-3 py-1.5 rounded-full text-sm border border-dashed border-gray-400 hover:border-purple-400 text-gray-500"
									>
										+ New stall
									</button>
								</div>
							)}
							<SectionHeader
								icon={Store}
								title={activeStallId ? 'Shop Profile' : 'New Shop Profile'}
								subtitle={activeStallId ? "Edit this stall's marketplace identity" : 'Create a new stall — fill in the details below'}
								open={shopOpen}
								onToggle={() => setShopOpen((v) => !v)}
								accent="purple"
							/>
							{shopOpen && (
								<div className="space-y-4 pl-1">
									<div className="space-y-2">
										<Label>
											Shop Banner <span className="text-muted-foreground font-normal">(optional — overrides personal banner)</span>
										</Label>
										<ImageUploader
											src={shopImages.banner || null}
											index={-1}
											imagesLength={1}
											forSingle
											initialUrl={shopImages.banner}
											onSave={({ url }) => setShopImages((p) => ({ ...p, banner: url }))}
											onDelete={() => setShopImages((p) => ({ ...p, banner: undefined }))}
											imageDimensionText="dimensions: 2000px Wide x 400px High"
										/>
									</div>

									<div className="space-y-2">
										<Label>
											Shop Logo / Avatar <span className="text-muted-foreground font-normal">(optional — overrides personal avatar)</span>
										</Label>
										<ImageUploader
											src={shopImages.picture || null}
											index={-1}
											imagesLength={1}
											forSingle
											initialUrl={shopImages.picture}
											onSave={({ url }) => setShopImages((p) => ({ ...p, picture: url }))}
											onDelete={() => setShopImages((p) => ({ ...p, picture: undefined }))}
											imageDimensionText="dimensions: 200px x 200px"
										/>
									</div>

									<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
										<div className="space-y-2">
											<Label htmlFor="shopName">
												<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Shop Name</span>
											</Label>
											<Input
												id="shopName"
												value={shopForm.name}
												onChange={(e) => setShopForm((p) => ({ ...p, name: e.target.value }))}
												placeholder="e.g. My Bitcoin Store"
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor="shopCurrency">
												Currency <span className="text-muted-foreground font-normal">(optional)</span>
											</Label>
											<Input
												id="shopCurrency"
												value={shopForm.currency}
												onChange={(e) => setShopForm((p) => ({ ...p, currency: e.target.value }))}
												placeholder="SATS"
											/>
										</div>
									</div>

									<div className="space-y-2">
										<Label htmlFor="shopDescription">
											Shop Description <span className="text-muted-foreground font-normal">(optional — overrides personal about)</span>
										</Label>
										<Textarea
											id="shopDescription"
											value={shopForm.description}
											onChange={(e) => setShopForm((p) => ({ ...p, description: e.target.value }))}
											placeholder="Describe your shop, what you sell, your policies..."
											rows={3}
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="shopLocation">
											Shop Location <span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
										<Input
											id="shopLocation"
											value={shopForm.location}
											onChange={(e) => setShopForm((p) => ({ ...p, location: e.target.value }))}
											placeholder="e.g. New York, USA"
										/>
									</div>

									<Button
										type="button"
										disabled={isLoading || !canSaveShop}
										className="btn-black w-full lg:hidden flex items-center justify-center gap-2"
										onClick={handleSaveShop}
									>
										<Store className="w-4 h-4" />
										{publishShopMutation.isPending
											? 'Publishing to Nostr...'
											: canSaveShop
												? fetchedShopProfile
													? 'Update Shop Profile'
													: 'Create Shop Profile'
												: 'Shop Profile Saved'}
									</Button>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
