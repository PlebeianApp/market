import { cn } from '@/lib/utils'
import { Nip05Badge } from './Nip05Badge'
import { ProfileName } from './ProfileName'

interface UserNameWithBadgeProps {
	userId: string
	className?: string
}

export function UserNameWithBadge({ userId, className = '' }: UserNameWithBadgeProps) {
	return (
		<div className={cn('flex items-center gap-2', className)}>
			<Nip05Badge pubkey={userId} />
			<ProfileName pubkey={userId} className="underline" />
		</div>
	)
}
