import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn, isValidHexKey } from '@/lib/utils'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { Nip05Badge } from './Nip05Badge'
import { ProfileName } from './ProfileName'
import { nip19 } from 'nostr-tools'

interface UserWithAvatarProps {
	pubkey: string
	className?: string
	size?: 'sm' | 'md' | 'lg'
	showBadge?: boolean
	disableLink?: boolean
	showHoverEffects?: boolean
	truncate?: boolean
}

export function UserWithAvatar({
	pubkey,
	className = '',
	size = 'md',
	showBadge = true,
	disableLink = false,
	showHoverEffects = false,
	truncate = true,
}: UserWithAvatarProps) {
	// Validate pubkey to prevent crashes with invalid data
	const validPubkey = isValidHexKey(pubkey)

	const { data: profileData, isLoading } = useQuery({
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

	const hoverAvatarClass = showHoverEffects ? 'transition-all duration-200' : ''

	const hoverTextClass = showHoverEffects ? 'transition-colors duration-200 group-hover:text-[#ff3eb5]' : ''

	const content = (
		<>
			<Avatar className={cn(avatarSizeClass, hoverAvatarClass)}>
				<AvatarImage src={profileData?.profile?.picture} />
				<AvatarFallback>{nameInitial}</AvatarFallback>
			</Avatar>
			<div className="flex flex-row items-center gap-1">
				<ProfileName pubkey={pubkey} className={cn(textSizeClass, hoverTextClass)} truncate={truncate} disableLink={true} />
				{showHoverEffects && (
					<ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[#ff3eb5]" />
				)}
				{showBadge && <Nip05Badge pubkey={pubkey} />}
			</div>
		</>
	)

	const containerClass = cn(
		'flex items-center gap-2',
		showHoverEffects && 'group px-2 py-1 rounded border border-transparent hover:bg-gray-100 hover:border-[#ff3eb5] transition-colors duration-200',
		className,
	)

	if (disableLink) {
		return <div className={containerClass}>{content}</div>
	}

	return (
		<Link
			to={`https://njump.me/${nip19.npubEncode(pubkey)}`}
			params={{ profileId: pubkey }}
			className={containerClass}
			onClick={(e) => e.stopPropagation()}
			target="_blank"
			rel="noopener noreferrer"
		>
			{content}
		</Link>
	)
}
