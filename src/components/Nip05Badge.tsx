import { nip05ValidationQueryOptions } from '@/queries/profiles'
import { useQuery } from '@tanstack/react-query'
import { BadgeAlert, BadgeCheck, CircleQuestionMark } from 'lucide-react'

interface Nip05BadgeProps {
	pubkey: string
	className?: string
}

export function Nip05Badge({ pubkey, className = '' }: Nip05BadgeProps) {
	const { data: isVerified, isLoading } = useQuery(nip05ValidationQueryOptions(pubkey))

	if (isLoading) {
		return <CircleQuestionMark className={`h-6 w-6 ${className} text-blue-500 animate-pulse`} />
	}

	if (isVerified === null) {
		return <CircleQuestionMark className={`h-6 w-6 ${className} text-black`} />
	}

	if (isVerified === true) {
		return <BadgeCheck style={{ fill: 'var(--secondary)', color: 'var(--primary)' }} className={`w-6 h-6 mt-1 ${className}`} />
	}

	if (isVerified === false) {
		return <BadgeAlert style={{ fill: 'var(--destructive)', color: 'var(--primary)' }} className={`w-6 h-6 mt-1 ${className}`} />
	}

	return null
}
