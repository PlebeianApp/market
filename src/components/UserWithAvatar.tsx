import { Link } from '@tanstack/react-router'
import { Nip05Badge } from './Nip05Badge'
import { ProfileName } from './ProfileName'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { profileKeys } from '@/queries/queryKeyFactory'
import { fetchProfileByIdentifier } from '@/queries/profiles'

interface UserWithAvatarProps {
	pubkey: string
	className?: string
	size?: 'sm' | 'md' | 'lg'
	showBadge?: boolean
	disableLink?: boolean
}

export function UserWithAvatar({ pubkey, className = '', size = 'md', showBadge = true, disableLink = false }: UserWithAvatarProps) {
	const { data: profile, isLoading } = useQuery({
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

	const nameInitial = profile?.name || profile?.displayName || pubkey.slice(0, 1).toUpperCase()

	const content = (
		<div className={cn(
			"flex items-center gap-1 border border-gray-300 rounded px-2 py-1 inline-flex max-w-[140px] overflow-hidden",
			!disableLink && "hover:bg-muted/50 hover:border-primary transition-colors duration-200"
		)}>
			<Avatar className={cn(avatarSizeClass, "flex-shrink-0")}>
				<AvatarImage src={profile?.picture} />
				<AvatarFallback>{nameInitial}</AvatarFallback>
			</Avatar>
			<div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-hidden">
				<ProfileName 
					pubkey={pubkey} 
					className={cn(
						textSizeClass,
						"truncate",
						!disableLink && 'hover:text-primary transition-colors duration-200'
					)} 
					truncate={true} 
					disableLink={true} 
				/>
				{showBadge && <Nip05Badge userId={pubkey} className="flex-shrink-0" />}
			</div>
		</div>
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
