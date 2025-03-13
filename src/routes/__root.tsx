import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { useAppSettings } from '@/queries/appSettings'

export const Route = createRootRoute({
	component: () => {
		const { data: appSettings } = useAppSettings()

		return (
			<>
				<div className="p-2 flex gap-2 items-center">
					{appSettings?.picture && <img src={appSettings.picture} alt={appSettings.displayName} className="h-8 w-8 rounded-full" />}
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
