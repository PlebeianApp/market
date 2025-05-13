import { useProfileName } from '@/queries/profiles'
import { Skeleton } from './ui/skeleton'
import { cn } from '@/lib/utils'
import { Link } from '@tanstack/react-router'

interface ProfileNameProps extends React.HTMLAttributes<HTMLSpanElement> {
	pubkey: string
	truncate?: boolean
	disableLink?: boolean
}

export function ProfileName({ pubkey, truncate = true, disableLink = false, className, ...props }: ProfileNameProps) {
	const { data: name, isLoading } = useProfileName(pubkey)

	if (isLoading) {
		return <Skeleton className={cn('h-4 w-24', className)} />
	}

	const displayName = name || (truncate ? pubkey.slice(0, 8) + '...' : pubkey)

	if (disableLink) {
		return <span className={cn(className)} {...props}>{displayName}</span>
	}

	return (
		<Link to="/profile/$profileId" params={{ profileId: pubkey }} className={cn(className)} {...props}>
			<span>{displayName}</span>
		</Link>
	)
}
