import { useConfigQuery } from '@/queries/config'
import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { useEffect } from 'react'

export const Route = createRootRoute({
	component: RootComponent,
})

function RootComponent() {
	return <RootLayout />
}

function RootLayout() {
	const { data: config, isLoading, isError } = useConfigQuery()
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
}
