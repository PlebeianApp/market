// src/components/cms/CMSUserProfile.tsx
import { ndkActions } from '@/lib/stores/ndk'
import { isValidUserProfile } from '@/lib/utils/user'
import NDK, { NDKUser, type NDKUserProfile } from '@nostr-dev-kit/ndk'
import { useState, useEffect } from 'react'

export interface CMSUserProfileProps {
	identifier: string
	relayUrl?: string
}

export const CMSUserProfile = ({ identifier, relayUrl }: CMSUserProfileProps) => {
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

	if (loading) return <div className="py-4 text-center text-muted-foreground">Loading profile...</div>
	if (error) return <div className="py-4 text-center text-destructive">Error: {error}</div>
	if (!profile) return <div className="py-4 text-center text-muted-foreground">No profile found</div>

	return (
		<div className="flex items-center gap-4 p-4 border rounded-lg bg-card">
			{profile.picture && (
				<img src={profile.picture} alt={profile.name || 'Profile'} className="w-16 h-16 rounded-full object-cover border" />
			)}
			<div>
				<h3 className="font-semibold text-foreground">{profile.name || 'Anonymous'}</h3>
				{profile.about && <p className="text-sm text-muted-foreground">{profile.about}</p>}
				{profile.nip05 && <p className="text-xs text-muted-foreground mt-1">{profile.nip05}</p>}
			</div>
		</div>
	)
}
