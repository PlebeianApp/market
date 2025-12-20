import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Nip05Badge } from './Nip05Badge'
import { ProfileName } from './ProfileName'
import { nip19 } from 'nostr-tools'

interface UserWithAvatarProps {
	pubkey: string
	className?: string
	size?: 'sm' | 'md' | 'lg'
	showBadge?: boolean
	disableLink?: boolean
}

// Helper to check if a string is a valid Nostr pubkey (64-hex characters)
const isValidPubkey = (pubkey: string): boolean => /^[a-f0-9]{64}$/i.test(pubkey)

export function UserWithAvatar({ pubkey, className = '', size = 'md', showBadge = true, disableLink = false }: UserWithAvatarProps) {
	// Validate pubkey to prevent crashes with invalid data
	const validPubkey = isValidPubkey(pubkey)

	const { data: profileData } = useQuery({
		queryKey: profileKeys.details(pubkey),
		queryFn: () => fetchProfileByIdentifier(pubkey),
		enabled: validPubkey, // Only fetch if pubkey is valid
	})

	// Return placeholder for invalid pubkeys
	if (!validPubkey) {
		return (
			<div className={cn('flex items-center gap-2 text-gray-400', className)}>
				<span className="text-sm">Unknown seller</span>
			</div>
		)
	}

	const avatarSizeClass = {
		sm: 'h-6 w-6',
		md: 'h-8 w-8',
		lg: 'h-10 w-10',
	}[size]

	const textSizeClass = {
		sm: 'text-xs',
		md: 'text-sm',
		lg: 'text-base',
	}[size]

	const nameInitial = profileData?.profile?.name || profileData?.profile?.displayName || pubkey.slice(0, 1).toUpperCase()

	const content = (
		<>
			<Avatar className={avatarSizeClass}>
				<AvatarImage src={profileData?.profile?.picture} />
				<AvatarFallback>{nameInitial}</AvatarFallback>
			</Avatar>
			<div className="flex flex-row items-center gap-1">
				<ProfileName pubkey={pubkey} className={textSizeClass} truncate={true} disableLink={true} />
				{showBadge && <Nip05Badge pubkey={pubkey} />}
			</div>
		</>
	)

	if (disableLink) {
		return <div className={cn('flex items-center gap-2', className)}>{content}</div>
	}

	return (
		<Link
			to={`https://njump.me/${nip19.npubEncode(pubkey)}`}
			params={{ profileId: pubkey }}
			className={cn('flex items-center gap-2', className)}
			onClick={(e) => e.stopPropagation()}
			target="_blank"
			rel="noopener noreferrer"
		>
			{content}
		</Link>
	)
}
