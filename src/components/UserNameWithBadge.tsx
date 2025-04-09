import { useProfileName } from '@/queries/profiles'
import { Nip05Badge } from './Nip05Badge'
import { Skeleton } from './ui/skeleton'

interface UserNameWithBadgeProps {
	userId: string
	className?: string
}

export function UserNameWithBadge({ userId, className = '' }: UserNameWithBadgeProps) {
	const { data: name, isLoading } = useProfileName(userId)

	if (isLoading) {
		return (
			<div className={`flex items-center gap-2 ${className}`}>
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-6 w-6" />
			</div>
		)
	}

	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<Nip05Badge userId={userId} />
			<span className="underline">{name || userId.slice(0, 8) + '...'}</span>
		</div>
	)
}
