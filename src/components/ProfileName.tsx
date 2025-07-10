import { useProfileName } from '@/queries/profiles'
import { Skeleton } from './ui/skeleton'
import { cn } from '@/lib/utils'
import { Link } from '@tanstack/react-router'

interface ProfileNameProps extends React.HTMLAttributes<HTMLSpanElement> {
	pubkey: string
	disableLink?: boolean
}

export function ProfileName({ pubkey, disableLink = false, className, ...props }: ProfileNameProps) {
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
			<span>{displayName}</span>
		</Link>
	)
}
