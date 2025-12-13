import { cn } from '@/lib/utils'
import { useProfileName } from '@/queries/profiles'
import { Link } from '@tanstack/react-router'
import { Skeleton } from './ui/skeleton'
import { nip19 } from 'nostr-tools'

interface ProfileNameProps extends React.HTMLAttributes<HTMLSpanElement> {
	pubkey: string
	truncate?: boolean
	disableLink?: boolean
}

/**
 * Formats a pubkey for display when no profile name is available.
 * Shows truncated npub like "npub1abc...xyz" or full npub based on truncate param.
 */
function formatPubkeyFallback(pubkey: string, truncate: boolean): string {
	try {
		const npub = nip19.npubEncode(pubkey)
		if (truncate) {
			// Show first 10 chars + "..." + last 4 chars
			return `${npub.slice(0, 10)}...${npub.slice(-4)}`
		}
		return npub
	} catch {
		// Fallback if npub encoding fails
		if (truncate) {
			return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
		}
		return pubkey
	}
}

/**
 * Formats a name/npub for mobile display (below 640px).
 * Shows first 12 chars + "..." + last 8 chars.
 */
function formatForMobile(text: string): string {
	if (text.length <= 23) return text // 12 + 3 + 8 = 23, no need to truncate
	return `${text.slice(0, 12)}...${text.slice(-8)}`
}

export function ProfileName({ pubkey, truncate = true, disableLink = false, className, ...props }: ProfileNameProps) {
	const { data: name, isLoading } = useProfileName(pubkey)

	if (isLoading) {
		return <Skeleton className={cn('h-4 w-24', className)} />
	}

	// Use profile name if available, otherwise show npub (truncated or full based on prop)
	const displayName = name || formatPubkeyFallback(pubkey, truncate)
	const truncatedName = truncate && name ? name.slice(0, 20) : displayName
	const mobileName = formatForMobile(truncatedName)

	const content = (
		<>
			{/* Truncated: below 640px and between 1024-1280px */}
			<span className="sm:hidden lg:inline xl:hidden">{mobileName}</span>
			{/* Full: 640-1024px and above 1280px */}
			<span className="hidden sm:inline lg:hidden xl:inline">{truncatedName}</span>
		</>
	)

	if (disableLink) {
		return (
			<span className={cn('break-all', className)} {...props}>
				{content}
			</span>
		)
	}

	return (
		<Link to="/profile/$profileId" params={{ profileId: pubkey }} className={cn('break-all', className)} {...props}>
			{content}
		</Link>
	)
}
