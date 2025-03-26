import { DecryptPasswordDialog } from '@/components/auth/DecryptPasswordDialog'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { Profile } from '@/components/Profile'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { useConfigQuery } from '@/queries/config'
import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

export const Route = createRootRoute({
	component: RootComponent,
})

function RootComponent() {
	return <RootLayout />
}

function RootLayout() {
	const { data: config, isLoading, isError } = useConfigQuery()
	const { isAuthenticated, isAuthenticating } = useStore(authStore)
	const [showLoginDialog, setShowLoginDialog] = useState(false)
	const navigate = useNavigate()

	useEffect(() => {
		if (isLoading || isError) return
		if (config?.needsSetup && window.location.pathname !== '/setup') {
			navigate({ to: '/setup' })
		} else if (!config?.needsSetup && window.location.pathname === '/setup') {
			navigate({ to: '/' })
		}
	}, [config, navigate, isLoading, isError])

	if (isLoading || window.location.pathname === '/setup') {
		return <Outlet />
	}

	return (
		<>
			<div className="p-2 flex justify-between gap-2 items-center">
				<div className="flex gap-2 items-center">
					{config?.appSettings?.picture && (
						<img src={config.appSettings.picture} alt={config.appSettings.displayName} className="h-8 w-8 rounded-full" />
					)}
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
					<Button onClick={() => setShowLoginDialog(true)}>Login</Button>
				)}
			</div>
			<hr />
			<Outlet />
			<TanStackRouterDevtools />
			<DecryptPasswordDialog />
			<LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
		</>
	)
}
