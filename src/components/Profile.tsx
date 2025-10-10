import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore, authActions } from '@/lib/stores/auth'
import { cn } from '@/lib/utils'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { useStore } from '@tanstack/react-store'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'

interface ProfileProps {
	compact?: boolean
}

export function Profile({ compact = false }: ProfileProps) {
	const authState = useStore(authStore)
	const navigate = useNavigate()
	const location = useLocation()

	// Check if we're on the user's own profile page
	const isOnOwnProfile = authState.user?.pubkey && location.pathname === `/profile/${authState.user.pubkey}`

	// Use TanStack Query for profile data
	const { data: profileData, isLoading } = useQuery({
		...profileByIdentifierQueryOptions(authState.user?.pubkey || ''),
		enabled: !!authState.user?.pubkey,
	})

	const profile = profileData?.profile

	// Trigger profile preloading when component renders and user is authenticated
	useEffect(() => {
		if (authState.isAuthenticated && authState.user && !profile) {
			console.log('🔄 Profile Component: Triggering profile preload for:', authState.user.pubkey)
			authActions.preloadUserProfile(authState.user).catch((error) => {
				console.error('❌ Profile Component: Profile preload failed for:', authState.user.pubkey, 'Error:', error)
			})
		}
	}, [authState.isAuthenticated, authState.user, profile])

	const displayName = profile?.name || 'Local User'

	const handleProfileClick = () => {
		if (authState.isAuthenticated && authState.user?.pubkey) {
			navigate({ to: '/profile/$profileId', params: { profileId: authState.user.pubkey } })
		}
	}

	if (isLoading && Date.now() - performance.now() < 500) {
		return null
	}

	if (isLoading) {
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
