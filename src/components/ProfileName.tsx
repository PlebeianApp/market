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
 * Shows truncated npub like "npub1abc...xyz" for better UX.
 */
function formatPubkeyFallback(pubkey: string): string {
	try {
		const npub = nip19.npubEncode(pubkey)
		// Show first 10 chars + "..." + last 4 chars
		return `${npub.slice(0, 10)}...${npub.slice(-4)}`
	} catch {
		// Fallback if npub encoding fails
		return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
	}
}

export function ProfileName({ pubkey, truncate = true, disableLink = false, className, ...props }: ProfileNameProps) {
	const { data: name, isLoading } = useProfileName(pubkey)

	if (isLoading) {
		return <Skeleton className={cn('h-4 w-24', className)} />
	}

	// Use profile name if available, otherwise show truncated npub
	const displayName = name || formatPubkeyFallback(pubkey)

	if (disableLink) {
		return (
			<span className={cn('break-all', className)} {...props}>
				{displayName}
			</span>
		)
	}

	return (
		<Link to="/profile/$profileId" params={{ profileId: pubkey }} className={cn('break-all', className)} {...props}>
			<span>{truncate && name ? name.slice(0, 20) : displayName}</span>
		</Link>
	)
}
