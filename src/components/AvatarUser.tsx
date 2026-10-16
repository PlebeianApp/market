import { getNormalizedProfileDisplayName, getNormalizedProfilePicture, useProfile } from '@/queries/profiles'
import { ProfileAvatarView, type ProfileAvatarViewProps } from '@ui/components/ProfileViews'

interface AvatarUserProps extends Omit<ProfileAvatarViewProps, 'name' | 'picture' | 'isLoading'> {
	pubkey?: string
}

function AvatarUser({ pubkey, ...props }: AvatarUserProps) {
	const { data: profileData, isLoading } = useProfile(pubkey)
	const { profile } = profileData ?? {}

	return (
		<ProfileAvatarView
			name={getNormalizedProfileDisplayName(profile)}
			picture={getNormalizedProfilePicture(profile)}
			isLoading={isLoading}
			{...props}
		/>
	)
}

export { AvatarUser }
