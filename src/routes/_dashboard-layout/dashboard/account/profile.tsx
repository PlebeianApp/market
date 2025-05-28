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
import { useForm } from '@tanstack/react-form'
import { useUpdateProfileMutation } from '@/publish/profiles'
import { useQuery } from '@tanstack/react-query'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/profile')({
	component: ProfileComponent,
})

function ProfileComponent() {
	useDashboardTitle('Profile')
	const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
	const ndk = ndkActions.getNDK()
	const pubkey = ndk?.activeUser?.pubkey

	// Fetch profile data with Tanstack Query
	const { data: fetchedProfile, isLoading: isLoadingProfile } = useQuery({
		...profileByIdentifierQueryOptions(pubkey || ''),
		enabled: !!pubkey,
	})

	// Manage local state for profile data
	const [profile, setProfile] = useState<NDKUserProfile>({})

	// Update profile mutation
	const updateProfileMutation = useUpdateProfileMutation()
	const isLoading = isLoadingProfile || updateProfileMutation.isPending

	// Update local state when fetched profile changes
	useEffect(() => {
		if (fetchedProfile) {
			setProfile(fetchedProfile)
		}
	}, [fetchedProfile])

	const form = useForm({
		defaultValues: {
			name: profile.name || '',
			banner: profile.banner || '',
			picture: profile.picture || '',
			displayName: profile.displayName || '',
			about: profile.about || '',
			nip05: profile.nip05 || '',
			lud16: profile.lud16 || '',
			lud06: profile.lud06 || '',
			website: profile.website || '',
		},
		onSubmit: async ({ value }) => {
			if (!pubkey) {
				toast.error('No active user')
				return
			}

			updateProfileMutation.mutate(value)
		},
	})

	// Update form values when profile changes
	useEffect(() => {
		form.reset({
			name: profile.name || '',
			banner: profile.banner || '',
			picture: profile.picture || '',
			displayName: profile.displayName || '',
			about: profile.about || '',
			nip05: profile.nip05 || '',
			lud16: profile.lud16 || '',
			lud06: profile.lud06 || '',
			website: profile.website || '',
		})
	}, [profile])

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
		<div className="space-y-6">
			{!isMobile && <h1 className="text-2xl font-bold">Profile</h1>}

			{isLoadingProfile ? (
				<div className="flex items-center justify-center p-8">
					<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
				</div>
			) : (
				<form
					onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
						e.preventDefault()
						form.handleSubmit()
					}}
					className="space-y-6"
				>
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

						<form.Field
							name="name"
							validators={{
								onChange: (field) => {
									if (!field.value) return 'Name is required'
									return undefined
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>
										<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Name</span>
									</Label>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="e.g Clothes Collection"
										required
									/>
									{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
										<div className="text-red-500 text-sm">{field.state.meta.errors.join(', ')}</div>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="displayName"
							validators={{
								onChange: (field) => {
									if (!field.value) return 'Display Name is required'
									return undefined
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>
										<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Display Name</span>
									</Label>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="e.g Clothes Collection"
										required
									/>
									{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
										<div className="text-red-500 text-sm">{field.state.meta.errors.join(', ')}</div>
									)}
								</div>
							)}
						</form.Field>

						<form.Field name="about">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>About</Label>
									<Textarea
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="Write a short bio"
										rows={4}
									/>
								</div>
							)}
						</form.Field>

						<form.Field
							name="nip05"
							validators={{
								onChange: (field) => {
									if (field.value && !field.value.includes('@')) {
										return 'NIP05 address should include @ symbol'
									}
									return undefined
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>Nostr Address (NIP05)</Label>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="you@example.com"
									/>
									{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
										<div className="text-red-500 text-sm">{field.state.meta.errors.join(', ')}</div>
									)}
								</div>
							)}
						</form.Field>

						<form.Field name="lud16">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>Lightning Address (LUD16)</Label>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="you@walletprovider.com"
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="lud06">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>LNURL (LUD06)</Label>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="LNURL..."
									/>
								</div>
							)}
						</form.Field>

						<form.Field
							name="website"
							validators={{
								onChange: (field) => {
									if (field.value && !field.value.startsWith('http')) {
										return 'Website should start with http:// or https://'
									}
									return undefined
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={field.name}>Website</Label>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="https://yourwebsite.com"
									/>
									{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
										<div className="text-red-500 text-sm">{field.state.meta.errors.join(', ')}</div>
									)}
								</div>
							)}
						</form.Field>

						<Button type="submit" disabled={isLoading} className="w-full">
							{isLoading ? 'Saving...' : 'Save'}
						</Button>
					</div>
				</form>
			)}
		</div>
	)
}
