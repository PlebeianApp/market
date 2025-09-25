import { Skeleton } from '@/components/ui/skeleton'
import { nip05ValidationQueryOptions } from '@/queries/profiles'
import { useQuery } from '@tanstack/react-query'
import { BadgeAlert, BadgeCheck } from 'lucide-react'

interface Nip05BadgeProps {
	pubkey: string
	className?: string
}

export function Nip05Badge({ pubkey, className = '' }: Nip05BadgeProps) {
	const { data: isVerified, isLoading } = useQuery(nip05ValidationQueryOptions(pubkey))

	if (isLoading) {
		return <Skeleton className={`h-6 w-6 ${className}`} />
	}

	if (isVerified === true) {
		return <BadgeCheck style={{ fill: 'var(--secondary)', color: 'var(--primary)' }} className={`w-6 h-6 mt-1 ${className}`} />
	}

	if (isVerified === false) {
		return <BadgeAlert style={{ fill: 'var(--destructive)', color: 'var(--primary)' }} className={`w-6 h-6 mt-1 ${className}`} />
	}

	return null
}
