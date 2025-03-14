import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { useAppSettings } from '@/queries/appSettings'
import { useEffect } from 'react'

export const Route = createRootRoute({
	component: () => {
		const { data: config } = useAppSettings()
		const navigate = useNavigate()

		useEffect(() => {
			// If app needs setup and we're not already on the setup page
			if (config?.needsSetup && window.location.pathname !== '/setup') {
				navigate({ to: '/setup' })
			}
		}, [config, navigate])

		// Don't show header on setup page
		if (window.location.pathname === '/setup') {
			return <Outlet />
		}

		return (
			<>
				<div className="p-2 flex gap-2 items-center">
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
				<hr />
				<Outlet />
				<TanStackRouterDevtools />
			</>
		)
	},
})
