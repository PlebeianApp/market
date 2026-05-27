import { useEffect, useState } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKUserProfile } from '@nostr-dev-kit/ndk'

export interface ArtistBioProps {
	identifier: string // npub, nsec, or hex
	alignment?: 'left' | 'center'
}

export const ArtistBio: React.FC<ArtistBioProps> = ({ identifier, alignment = 'left' }) => {
	const [profile, setProfile] = useState<NDKUserProfile | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const fetch = async () => {
			const ndk = ndkActions.getNDK()!
			try {
				const user = await ndk.fetchUser(identifier)
				const profile = await user?.fetchProfile()
				setProfile(profile || null)
			} catch (e) {
				console.error('Failed to fetch profile', e)
			} finally {
				setLoading(false)
			}
		}
		if (identifier) fetch()
	}, [identifier])

	if (loading) return <div>Loading artist...</div>
	if (!profile) return <div>Artist not found.</div>

	return (
		<div className={`flex flex-col md:flex-row gap-6 ${alignment === 'center' ? 'items-center text-center' : 'items-start text-left'}`}>
			{profile.picture && (
				<img src={profile.picture} alt={profile.name} className="w-32 h-32 rounded-full object-cover border-4 border-orange-500" />
			)}
			<div>
				<h2 className="text-2xl font-bold">{profile.name || 'Anonymous'}</h2>
				<p className="text-gray-600 mt-2">{profile.about}</p>
				{profile.nip05 && <p className="text-sm text-gray-500 mt-1">@{profile.nip05}</p>}
			</div>
		</div>
	)
}
