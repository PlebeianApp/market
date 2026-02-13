import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore } from '@/lib/stores/auth'
import { cn } from '@/lib/utils'
import { useProfile } from '@/queries/profiles'
import { useStore } from '@tanstack/react-store'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

interface ProfileProps {
	compact?: boolean
}

export function Profile({ compact = false }: ProfileProps) {
	const authState = useStore(authStore)
	const navigate = useNavigate()
	const location = useLocation()

	const { data, isPending, fetchStatus } = useProfile(authState.user?.pubkey)
	const profile = data?.profile ?? null

	// Check if we're on the user's own profile page
	const isOnOwnProfile = authState.user?.pubkey && location.pathname === `/profile/${authState.user.pubkey}`

	const displayName = profile?.name || 'Local User'

	const handleProfileClick = () => {
		if (authState.isAuthenticated && authState.user?.pubkey) {
			navigate({ to: '/profile/$profileId', params: { profileId: authState.user.pubkey } })
		}
	}

	// Only show spinner while actively fetching for the first time
	if (isPending && fetchStatus === 'fetching') {
		return (
			<Button variant="ghost" size={compact ? 'icon' : 'default'} disabled>
				<Loader2 className={cn('h-4 w-4 animate-spin', !compact && 'mr-2')} />
				{!compact && 'Loading...'}
			</Button>
		)
	}

	// Both desktop and mobile - simple button that navigates to profile when authenticated
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant={authState.isAuthenticated ? 'primary' : 'outline'}
						size={compact ? 'icon' : 'default'}
						className={cn(
							'p-2 w-full relative',
							!authState.isAuthenticated && 'text-muted-foreground hover:text-foreground',
							isOnOwnProfile && 'bg-secondary text-black hover:bg-secondary hover:text-black',
						)}
						onClick={handleProfileClick}
					>
						{compact && authState.isAuthenticated ? (
							<Avatar className="w-6 h-6">
								<AvatarImage src={profile?.picture} />
								<AvatarFallback className={cn('text-xs', isOnOwnProfile ? 'bg-white text-secondary' : 'bg-secondary text-black')}>
									{(profile?.name || profile?.displayName || authState.user?.pubkey?.slice(0, 1))?.charAt(0).toUpperCase()}
								</AvatarFallback>
							</Avatar>
						) : (
							<>
								{authState.isAuthenticated ? (
									<span className={cn('i-account w-6 h-6', isOnOwnProfile && 'text-black')} />
								) : (
									<span className="i-account w-6 h-6" />
								)}
							</>
						)}
						{!compact && displayName}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom" align="end">
					{authState.isAuthenticated ? 'Go to profile' : "You're browsing anonymously"}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
