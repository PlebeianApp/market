// src/components/cms/CMSUserProfile.tsx
import { ndkActions } from '@/lib/stores/ndk'
import { isValidUserProfile } from '@/lib/utils/userValidation'
import NDK, { type NDKUserProfile } from '@nostr-dev-kit/ndk'
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

				const userProfile = await ndk.fetchUser(identifier)?.then((user) => user?.fetchProfile())
				setProfile(userProfile ?? null)
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to fetch profile')
			} finally {
				setLoading(false)
			}
		}

		if (isValidUserProfile(identifier)) {
			console.log('Fetch profile:')
			fetchProfile()
		} else {
			setLoading(false)
			setError('Invalid user identifer.')
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
			</div>
		</div>
	)
}
