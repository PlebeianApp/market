import { cn } from '@/lib/utils'
import { Nip05Badge } from './Nip05Badge'
import { ProfileName } from './ProfileName'

interface UserNameWithBadgeProps {
	pubkey: string
	className?: string
}

export function UserNameWithBadge({ pubkey, className = '' }: UserNameWithBadgeProps) {
	return (
		<div className={cn('flex items-center gap-2', className)}>
			<Nip05Badge pubkey={pubkey} />
			<ProfileName pubkey={pubkey} className="underline" />
		</div>
	)
}
