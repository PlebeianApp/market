import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { useProfile } from '@/queries/profiles'

interface AvatarUserProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
	pubkey?: string
}

function AvatarUser({ pubkey, className }: AvatarUserProps) {
	const { data: profileData } = useProfile(pubkey)
	const { profile, user } = profileData ?? {}

	// Determine fallback text
	const getFallbackText = () => {
		const title = profile?.displayName ?? profile?.name ?? 'p'
		return title?.charAt(0).toUpperCase()
	}

	return (
		<AvatarPrimitive.Root data-slot="avatar" className={'relative flex size-8 shrink-0 overflow-hidden rounded-full w-6 h-6 ' + className}>
			{profile?.picture ? (
				// If profile picture is present, return image as avatar
				<AvatarPrimitive.Image data-slot="avatar-image" className="aspect-square size-full" src={profile?.picture} />
			) : (
				// If no profile picture, return fallback avatar
				<AvatarPrimitive.Fallback
					data-slot="avatar-fallback"
					className="bg-neo-purple text-white flex size-full items-center justify-center rounded-full text-center"
				>
					{getFallbackText()}
				</AvatarPrimitive.Fallback>
			)}
		</AvatarPrimitive.Root>
	)
}

export { AvatarUser }
