import * as React from 'react'

import { Avatar } from '@/components/ui-wrappers/Avatar'
import { cn } from '@/lib/utils'
import { useProfile } from '@/queries/profiles'

/**
 * Library-neutral profile shape — avoids importing NDK types directly
 * (NDK footprint guard). Only the fields this component uses are
 * declared; the real NDK profile type is structurally compatible.
 */
export interface UserProfile {
	displayName?: string
	name?: string
	picture?: string
	nip05?: string
}

export interface UserDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Pubkey of the user to display. The component fetches profile data
	 * via `useProfile` (the documented nostr/ hooks exception). */
	pubkey: string
	/** Callback fired when the user display is clicked/pressed. */
	onPress?: (pubkey: string) => void
	/** Size variant for the avatar. */
	size?: 'xs' | 'sm' | 'md' | 'lg'
	/** Show NIP-05 verification badge if available. */
	showNip05?: boolean
	/** Additional profile data. If provided, skips the `useProfile` fetch. */
	profile?: UserProfile | null
}

/**
 * UserDisplay — a Nostr-domain component that displays a user's avatar and
 * display name.
 *
 * This component demonstrates the `nostr/` directory pattern:
 * - Uses `useProfile` hook inline (the documented hooks exception per
 *   `nostr/AGENTS.md` — Nostr data hooks are allowed in `nostr/`)
 * - Accepts a callback (`onPress`) for user interaction instead of
 *   navigating inline
 * - Accepts an optional `profile` prop to skip the fetch when the parent
 *   already has the data
 * - Uses `forwardRef`, `cn()`, and semantic tokens
 * - Imports from `ui-wrappers/` (Avatar) — follows the import hierarchy
 *
 * This is a new component that demonstrates the pattern. The existing
 * `UserCard.tsx` (at `src/components/UserCard.tsx`) will be migrated to
 * `nostr/` in a later slice.
 */
const UserDisplay = React.forwardRef<HTMLDivElement, UserDisplayProps>(
	({ pubkey, onPress, size = 'sm', showNip05 = false, profile: profileProp, className, ...props }, ref) => {
		const { data: profileData } = useProfile(profileProp ? undefined : pubkey)
		const profile = profileProp ?? profileData?.profile
		const user = profileData?.user

		const displayName = profile?.displayName ?? profile?.name ?? user?.npub?.slice(0, 12) ?? pubkey.slice(0, 12)

		return (
			<div
				ref={ref}
				className={cn('flex items-center gap-2', onPress && 'cursor-pointer', className)}
				onClick={onPress ? () => onPress(pubkey) : undefined}
				role={onPress ? 'button' : undefined}
				tabIndex={onPress ? 0 : undefined}
				onKeyDown={
					onPress
						? (e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									onPress(pubkey)
								}
							}
						: undefined
				}
				{...props}
			>
				<Avatar src={profile?.picture} fallback={displayName} size={size} />
				<div className="flex flex-col min-w-0">
					<span className="font-medium text-foreground truncate">{displayName}</span>
					{showNip05 && profile?.nip05 && <span className="text-xs text-muted-foreground truncate">{profile.nip05}</span>}
				</div>
			</div>
		)
	},
)

UserDisplay.displayName = 'UserDisplay'

export { UserDisplay }