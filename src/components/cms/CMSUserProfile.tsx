// src/components/puck/NostrProfile.tsx
import { ndkActions } from '@/lib/stores/ndk'
import NDK, { type NDKUserProfile } from '@nostr-dev-kit/ndk'
import { useState, useEffect } from 'react'

export interface CMSUserProfileProps {
	pubkey: string
	relayUrl?: string
}

export const CMSUserProfile = ({ pubkey, relayUrl }: CMSUserProfileProps) => {
	const [profile, setProfile] = useState<NDKUserProfile | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const fetchProfile = async () => {
			try {
				const ndk = ndkActions.getNDK()!

				const userProfile = await ndk.fetchUser(pubkey)?.then((user) => user?.fetchProfile())
				setProfile(userProfile ?? null)
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to fetch profile')
			} finally {
				setLoading(false)
			}
		}

		if (pubkey) {
			fetchProfile()
		}
	}, [pubkey, relayUrl])

	if (loading) return <div>Loading profile...</div>
	if (error) return <div>Error: {error}</div>
	if (!profile) return <div>No profile found</div>

	return (
		<div className="flex items-center gap-4 p-4 border rounded-lg">
			{profile.picture && <img src={profile.picture} alt={profile.name || 'Profile'} className="w-16 h-16 rounded-full object-cover" />}
			<div>
				<h3 className="font-semibold">{profile.name || 'Anonymous'}</h3>
				{profile.about && <p className="text-sm text-gray-600">{profile.about}</p>}
			</div>
		</div>
	)
}
