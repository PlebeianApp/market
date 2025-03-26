import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Profile } from '@/components/Profile'
import { Button } from '@/components/ui/button'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'

type HeaderProps = {
	appPicture?: string
	appDisplayName?: string
	onLoginClick: () => void
}

export function Header({ appPicture, appDisplayName, onLoginClick }: HeaderProps) {
	const { isAuthenticated, isAuthenticating } = useStore(authStore)

	return (
		<header className="sticky top-0 bg-white border-b z-10 shadow-sm">
			<div className="p-4 flex justify-between gap-2 items-center max-w-7xl mx-auto">
				<div className="flex gap-2 items-center">
					{appPicture && <img src={appPicture} alt={appDisplayName} className="h-8 w-8 rounded-full" />}
					<Link to="/" className="[&.active]:font-bold">
						Home
					</Link>{' '}
					<Link to="/posts" className="[&.active]:font-bold">
						Posts
					</Link>
				</div>
				{isAuthenticating ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : isAuthenticated ? (
					<Profile />
				) : (
					<Button onClick={onLoginClick}>Login</Button>
				)}
			</div>
		</header>
	)
}
