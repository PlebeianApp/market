import { ScrollArea } from '@/components/ui/scroll-area'
import { dashboardNavigation } from '@/config/dashboardNavigation'
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

function DashboardLayout() {
	const matchRoute = useMatchRoute()

	return (
		<div>
			<h1 className="text-2xl font-heading mb-4 p-4 bg-black text-secondary">DASHBOARD</h1>

			<div className="flex m-6 gap-6 container max-h-[77vh] overflow-auto">
				{/* Sidebar */}
				<aside className="w-[25%] p-6 border-2 border-black">
					<div className="space-y-8">
						{dashboardNavigation.map((section) => (
							<div key={section.title}>
								<h2 className="text-md font-heading mb-4 bg-black text-white px-4 py-2">{section.title}</h2>
								<nav className="space-y-2">
									{section.items.map((item) => {
										const isActive = matchRoute({
											to: item.path,
											fuzzy: true,
										})
										return (
											<Link
												key={item.path}
												to={item.path}
												className={`block p-2 transition-colors font-bold ${isActive ? 'bg-gray-200 text-black' : 'hover:text-pink-500'}`}
											>
												{item.title}
											</Link>
										)
									})}
								</nav>
							</div>
						))}
					</div>
				</aside>

				{/* Main Content - limited to 33vh height */}
				<ScrollArea className="flex-1 p-8 border-2 border-black">
					<div className="mb-4">
						<Link to="/dashboard" className="inline-block px-4 py-4 bg-black text-white hover:bg-gray-800 transition-colors">
							<span className="i-back w-8 h-8" />
						</Link>
					</div>
					<Outlet />
				</ScrollArea>
			</div>
		</div>
	)
}
