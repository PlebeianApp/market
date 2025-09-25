import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Nip05Badge } from './Nip05Badge'
import { ProfileName } from './ProfileName'

interface UserWithAvatarProps {
	pubkey: string
	className?: string
	size?: 'sm' | 'md' | 'lg'
	showBadge?: boolean
	disableLink?: boolean
}

export function UserWithAvatar({ pubkey, className = '', size = 'md', showBadge = true, disableLink = false }: UserWithAvatarProps) {
	const { data: profileData, isLoading } = useQuery({
		queryKey: profileKeys.details(pubkey),
		queryFn: () => fetchProfileByIdentifier(pubkey),
	})

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
			to="/profile/$profileId"
			params={{ profileId: pubkey }}
			className={cn('flex items-center gap-2', className)}
			onClick={(e) => e.stopPropagation()}
		>
			{content}
		</Link>
	)
}
