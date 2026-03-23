import { getProfileNip05, nip05ValidationQueryOptions, useProfile } from '@/queries/profiles'
import { useQuery } from '@tanstack/react-query'
import { BadgeAlert, BadgeCheck, CircleQuestionMark, Loader2 } from 'lucide-react'

interface Nip05BadgeProps {
	pubkey?: string
	className?: string
	showAddress?: boolean
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

export function Nip05Badge({ pubkey, className = '', showAddress = true }: Nip05BadgeProps) {
	if (pubkey == null) return null

	const { data: profile, error } = useProfile(pubkey)
	const nip05 = profile?.profile?.nip05

	// Handle "no NIP-05" case - no badge, no text
	if (profile == null || nip05 == null || nip05.length == 0) {
		return null
	}

	const { data: isVerified, isLoading } = useQuery(nip05ValidationQueryOptions(pubkey))

	return (
		<div className="flex items-end gap-1">
			{isLoading ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : isVerified ? (
				<BadgeCheck style={{ fill: 'var(--secondary)', color: 'var(--primary)' }} className={`w-6 h-6 ${className}`} />
			) : (
				<BadgeAlert style={{ fill: 'var(--destructive)', color: 'var(--primary)' }} className={`w-6 h-6 ${className}`} />
			)}
			{showAddress && nip05 && <span className={'text-gray-400 ' + className}>{elideNip05Address(nip05)}</span>}
		</div>
	)
}
