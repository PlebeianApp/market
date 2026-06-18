import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { useProfile } from '@/queries/profiles'
import { getHexColorFingerprintFromHexPubkey, isValidHexKey } from '@/lib/utils'

interface AvatarUserProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
	pubkey?: string
	colored?: boolean
	deterministicFallbackText?: boolean
}

function AvatarUser({ pubkey, className, colored = false, deterministicFallbackText = false }: AvatarUserProps) {
	const { data: profileData } = useProfile(pubkey)
	const { profile, user } = profileData ?? {}
	const fallbackBackgroundColor = colored && pubkey && isValidHexKey(pubkey) ? getHexColorFingerprintFromHexPubkey(pubkey) : undefined

	const getDeterministicFallbackText = () => {
		if (!pubkey || !isValidHexKey(pubkey)) return 'P'
		return pubkey.slice(0, 2).toUpperCase()
	}

	// Determine fallback text
	const getFallbackText = () => {
		const title = profile?.displayName ?? profile?.name
		if (title) return title.charAt(0).toUpperCase()

		if (deterministicFallbackText) {
			return getDeterministicFallbackText()
		}

		return 'P'
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
					style={fallbackBackgroundColor ? { backgroundColor: fallbackBackgroundColor } : undefined}
				>
					{getFallbackText()}
				</AvatarPrimitive.Fallback>
			)}
		</AvatarPrimitive.Root>
	)
}

export { AvatarUser }
