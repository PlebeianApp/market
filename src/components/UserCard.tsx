import {
	getNormalizedProfileDisplayName,
	getNormalizedProfileNip05,
	normalizeOptionalPubkey,
	normalizeOptionalString,
	useProfile,
} from '@/queries/profiles'
import { AvatarUser } from './AvatarUser'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { Nip05Badge } from './Nip05Badge'
import { nip19 } from 'nostr-tools'
import { isValidHexKey, isValidNpub } from '@/lib/utils'
import { UserCardView } from '@ui/components/UserCardView'

export { getUserCardTitle, isKeyboardCopyActivationKey } from '@ui/components/UserCardView'

interface UserCardProps {
	pubkey?: string
	className?: string
	size?: 'xs' | 'sm' | 'md' | 'lg'
	subtitle?: 'npub' | 'nip-05' | 'none'
	onPress?: 'profile' | 'copy-npub' | 'none'
}

function encodeIdentifierToNpub(identifier: string | undefined): string | null {
	const trimmedIdentifier = identifier?.trim()
	if (!trimmedIdentifier) return null

	if (isValidNpub(trimmedIdentifier)) {
		return trimmedIdentifier
	}

	if (!isValidHexKey(trimmedIdentifier)) {
		return null
	}

	return nip19.npubEncode(trimmedIdentifier)
}

export function UserCard({ pubkey, className = '', size = 'md', subtitle = 'nip-05', onPress = 'profile' }: UserCardProps) {
	const safePubkey = normalizeOptionalPubkey(pubkey)
	const { data: profileData, isLoading } = useProfile(safePubkey)
	const { profile, user } = profileData || {}

	const breakpoint = useBreakpoint()
	const userNpub = normalizeOptionalString(user?.npub)
	const npub = userNpub && isValidNpub(userNpub) ? userNpub : encodeIdentifierToNpub(safePubkey)

	return (
		<UserCardView
			renderAvatar={(avatarClassName) => <AvatarUser pubkey={safePubkey} className={avatarClassName} />}
			isLoading={isLoading}
			displayName={getNormalizedProfileDisplayName(profile)}
			nip05={getNormalizedProfileNip05(profile)}
			npub={npub}
			renderNip05Badge={
				safePubkey
					? ({ className: badgeClassName, showAddress }) => (
							<Nip05Badge pubkey={safePubkey} className={badgeClassName} showAddress={showAddress} />
						)
					: undefined
			}
			profileHref={onPress === 'profile' && safePubkey ? `/profile/${safePubkey}` : undefined}
			compact={breakpoint === 'md' || breakpoint === 'sm'}
			className={className}
			size={size}
			subtitle={subtitle}
			copyNpub={onPress !== 'none'}
		/>
	)
}
