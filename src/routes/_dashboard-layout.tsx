import { dashboardNavigation } from '@/config/dashboardNavigation'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

function DashboardLayout() {
	return (
		<div className="flex min-h-screen m-6 gap-6">
			{/* Sidebar */}
			<aside className="w-64 p-6 border-2 border-black">
				<div className="space-y-8">
					{dashboardNavigation.map((section) => (
						<div key={section.title}>
							<h2 className="text-lg font-bold mb-4">{section.title}</h2>
							<nav className="space-y-2">
								{section.items.map((item) => (
									<Link key={item.path} to={item.path} className="block hover:text-pink-500">
										{item.title}
									</Link>
								))}
							</nav>
						</div>
					))}
				</div>
			</aside>

			{/* Main Content */}
			<main className="flex-1 p-8 border-2 border-black">
				<Outlet />
			</main>
		</div>
	)
}
