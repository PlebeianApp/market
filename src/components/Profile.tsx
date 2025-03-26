import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authActions, authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { cn } from '@/lib/utils'
import type { NDKUserProfile } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { Loader2, LogOut, Shield, UserCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'

interface ProfileProps {
	compact?: boolean
}

export function Profile({ compact = false }: ProfileProps) {
	const authState = useStore(authStore)
	const [profile, setProfile] = useState<NDKUserProfile | null>(null)
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		if (!authState.user?.pubkey) {
			setIsLoading(false)
			return
		}

		const fetchProfile = async () => {
			const pubkey = authState.user?.pubkey
			if (!pubkey) {
				setIsLoading(false)
				return
			}

			try {
				const ndk = ndkActions.getNDK()
				if (!ndk) {
					throw new Error('NDK not initialized')
				}

				const user = ndk.getUser({ pubkey })
				const profilePromise = await user.fetchProfile()

				setProfile(profilePromise)
			} catch (error) {
				console.error('Error fetching profile:', error)
			} finally {
				setIsLoading(false)
			}
		}

		fetchProfile()
	}, [authState.user?.pubkey])

	const displayName = profile?.name || 'Local User'

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

	return (
		<TooltipProvider>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant={authState.isAuthenticated ? 'primary' : 'outline'}
								size={compact ? 'icon' : 'default'}
								icon={authState.isAuthenticated ? <span className="i-log-out w-6 h-6" /> : <span className="i-account w-6 h-6" />}
								
								className={cn('p-2 w-full relative rounded-md', !authState.isAuthenticated && 'text-muted-foreground hover:text-foreground')}
							>
								{!compact && displayName}
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" align="end">
						{authState.isAuthenticated ? 'View profile options' : "You're browsing anonymously"}
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent className="w-56" align="end">
					<DropdownMenuLabel>
						{displayName}
						<span className="block text-xs text-muted-foreground truncate">{authState.user?.pubkey}</span>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => authActions.logout()}>
						<LogOut className="mr-2 h-4 w-4" />
						Log out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}
