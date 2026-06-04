// src/components/cms/CMSUserProfile.tsx
import { ndkActions } from '@/lib/stores/ndk'
import { isValidUserProfile } from '@/lib/utils/user'
import NDK, { NDKUser, type NDKUserProfile } from '@nostr-dev-kit/ndk'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

export interface CMSUserProfileProps {
	identifier: string
	relayUrl?: string
	backgroundImage?: string
	backgroundColor?: string
	overlayOpacity?: number
	height?: string
	ctaText?: string
	ctaLink?: string
	className?: string
}

export const CMSUserProfile = ({
	identifier,
	relayUrl,
	backgroundImage = '',
	backgroundColor = '',
	overlayOpacity = 0.4,
	height = '400px',
	ctaText = '',
	ctaLink = '#',
	className = '',
}: CMSUserProfileProps) => {
	const [profile, setProfile] = useState<NDKUserProfile | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const fetchProfile = async () => {
			setError(null)
			setLoading(true)

			try {
				const ndk = ndkActions.getNDK()!

				// Use ndk.fetchUser which handles hex pubkeys, npubs, nip-05s, etc.
				const user = await ndk.fetchUser(identifier)

				if (user) {
					// Fetch the profile for the user
					const userProfile = await user.fetchProfile()
					setProfile(userProfile ?? null)
				} else {
					setProfile(null)
				}
			} catch (err) {
				console.error('Failed to fetch user profile:', err)
				setError(err instanceof Error ? err.message : 'Failed to fetch profile')
				setProfile(null)
			} finally {
				setLoading(false)
			}
		}

		if (identifier && identifier.trim() !== '') {
			if (isValidUserProfile(identifier)) {
				fetchProfile()
			} else {
				setLoading(false)
				setError('Invalid user identifier.')
			}
		} else {
			setLoading(false)
			setError('No user identifier provided.')
		}
	}, [identifier, relayUrl])

	const displayName = profile?.displayName ?? profile?.name ?? 'Plebeian Seller'

	if (loading) return <div className="py-12 text-center text-muted-foreground">Loading profile...</div>
	if (error) return <div className="py-12 text-center text-destructive">Error: {error}</div>
	if (!profile) return <div className="py-12 text-center text-muted-foreground">No profile found</div>

	return (
		<div
			className={`relative w-full ${className}`}
			style={{
				backgroundImage: backgroundImage ? `url(${backgroundImage})` : backgroundColor ? `none` : 'none',
				backgroundColor: backgroundColor && !backgroundImage ? backgroundColor : 'transparent',
				backgroundSize: 'cover',
				backgroundPosition: 'center',
				backgroundRepeat: 'no-repeat',
				height: height,
			}}
		>
			{/* Overlay */}
			{backgroundImage && (
				<div
					className="absolute inset-0"
					style={{
						backgroundColor: 'black',
						opacity: overlayOpacity,
					}}
				></div>
			)}

			<div className="absolute inset-0 overflow-hidden flex items-center">
				<div className="max-w-7xl mx-auto px-6 w-full">
					<div className="flex items-center gap-8">
						{/* Profile Image with rounded borders */}
						<div className="flex-shrink-0 flex items-center h-full p-4">
							<div className="bg-background border border-border rounded-lg overflow-hidden shadow-lg">
								{profile.picture ? (
									<img
										src={profile.picture}
										alt={displayName}
										className="h-full max-h-full w-auto object-cover"
										style={{ maxHeight: '300px', width: '300px', height: '300px' }}
									/>
								) : (
									<div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground p-8">
										<div className="text-4xl font-bold">{displayName.charAt(0).toUpperCase()}</div>
									</div>
								)}
							</div>
						</div>

						{/* Profile Content */}
						<div className={`flex-1 text-center lg:text-left min-w-0 ${backgroundImage ? 'dark' : ''}`}>
							<div className="flex flex-col h-full justify-center">
								{/* Profile Name */}
								<h2 className="text-3xl md:text-4xl font-serif text-foreground mb-4">{displayName}</h2>

								{/* NIP-05 Badge */}
								{profile.nip05 && (
									<div className="inline-block bg-primary/10 text-primary px-3 py-1 rounded-full text-sm mb-6 max-w-min">
										{profile.nip05}
									</div>
								)}

								{/* Profile About/Description */}
								{profile.about && <p className="text-lg text-muted-foreground mb-8 max-w-2xl">{profile.about}</p>}

								{/* CTA Button */}
								{ctaText && (
									<div className="mt-4">
										<Button asChild>
											<a href={ctaLink}>{ctaText}</a>
										</Button>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
