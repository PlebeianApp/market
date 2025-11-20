import { nip05ValidationQueryOptions } from '@/queries/profiles'
import { useQuery } from '@tanstack/react-query'
import { BadgeAlert, BadgeCheck, CircleQuestionMark } from 'lucide-react'

interface Nip05BadgeProps {
	pubkey: string
	className?: string
	showAddress?: boolean
	nip05?: string
}

/**
 * Elides NIP-05 address according to NIP-05 spec:
 * - If identifier is _@domain.com, return only domain.com
 * - Otherwise return the full identifier
 */
function elideNip05Address(nip05: string): string {
	if (nip05.startsWith('_@')) {
		return nip05.slice(2) // Remove '_@' prefix
	}
	return nip05
}

export function Nip05Badge({ pubkey, className = '', showAddress = false, nip05 }: Nip05BadgeProps) {
	const { data: isVerified, isLoading } = useQuery(nip05ValidationQueryOptions(pubkey))

	if (isLoading) {
		return (
			<div className="flex items-center gap-2">
				<CircleQuestionMark className={`h-6 w-6 ${className} text-blue-500 animate-pulse`} />
				{showAddress && nip05 && <span className="text-sm text-gray-400">{elideNip05Address(nip05)}</span>}
			</div>
		)
	}

	if (isVerified === null) {
		return <CircleQuestionMark className={`h-6 w-6 ${className} text-black`} />
	}

	if (isVerified === true) {
		return (
			<div className="flex items-center gap-2">
				<BadgeCheck style={{ fill: 'var(--secondary)', color: 'var(--primary)' }} className={`w-6 h-6 mt-1 ${className}`} />
				{showAddress && nip05 && <span className="text-sm text-white">{elideNip05Address(nip05)}</span>}
			</div>
		)
	}

	if (isVerified === false) {
		return <BadgeAlert style={{ fill: 'var(--destructive)', color: 'var(--primary)' }} className={`w-6 h-6 mt-1 ${className}`} />
	}

	return null
}
