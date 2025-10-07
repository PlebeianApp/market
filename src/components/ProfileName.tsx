import { cn } from '@/lib/utils'
import { useProfileName } from '@/queries/profiles'
import { Link } from '@tanstack/react-router'
import { Skeleton } from './ui/skeleton'

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

	const displayName = name || pubkey

	if (disableLink) {
		return (
			<span className={cn('break-all', className)} {...props}>
				{displayName}
			</span>
		)
	}

	return (
		<Link to="/profile/$profileId" params={{ profileId: pubkey }} className={cn('break-all', className)} {...props}>
			<span>{truncate ? displayName.slice(0, 10) : displayName}</span>
		</Link>
	)
}
