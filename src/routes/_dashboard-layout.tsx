import React, { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { dashboardNavigation } from '@/config/dashboardNavigation'
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate, useLocation } from '@tanstack/react-router'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { uiStore, uiActions } from '@/lib/stores/ui'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

// Custom hook to manage dashboard title using uiStore
export function useDashboardTitle(title: string) {
	React.useEffect(() => {
		uiActions.setDashboardTitle(title)
		return () => uiActions.setDashboardTitle('DASHBOARD') // Reset to default on unmount
	}, [title])
}

// Helper to get emoji for current route
function getCurrentEmoji(showSidebar: boolean, currentPath: string): string | null {
	if (showSidebar) return null

	// Handle dashboard route specifically
	if (currentPath === '/dashboard') return '🛞'

	for (const section of dashboardNavigation) {
		for (const item of section.items) {
			if (currentPath.startsWith(item.path)) {
				const match = item.title.match(/^([^ ]+) /)
				return match ? match[1] : null
			}
		}
	}
	return null
}

function DashboardLayout() {
	const matchRoute = useMatchRoute()
	const navigate = useNavigate()
	const location = useLocation()
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint !== 'xl' // Changed back: treat anything below xl (1280px) as mobile
	const [showSidebar, setShowSidebar] = useState(true)
	const [parent] = useAutoAnimate()
	const { dashboardTitle } = useStore(uiStore)

	// When route changes on mobile, show sidebar for /dashboard, main content otherwise
	React.useEffect(() => {
		if (isMobile) {
			if (location.pathname === '/dashboard') {
				setShowSidebar(true)
			} else {
				setShowSidebar(false)
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [location.pathname, isMobile])

	const handleSidebarItemClick = () => {
		if (isMobile) setShowSidebar(false)
	}

	const handleBackToSidebar = () => {
		if (isMobile) {
			setShowSidebar(true)
			navigate({ to: '/dashboard' })
		}
	}

	const emoji = getCurrentEmoji(showSidebar, typeof window !== 'undefined' ? window.location.pathname : '')

	return (
		<div className="xl:block">
			{/* Header - responsive for mobile/desktop */}
			<h1 className="font-heading p-2 xl:p-4 bg-secondary-black text-secondary flex items-center gap-2 justify-center text-center xl:justify-start xl:text-2xl relative text-[2rem]">
				{/* Mobile back button - only visible on small screens when not showing sidebar */}
				{!showSidebar && breakpoint !== 'xl' && (
					<button
						onClick={handleBackToSidebar}
						className="flex items-center justify-center text-secondary focus:outline-none absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 xl:hidden"
						aria-label="Back to sidebar"
					>
						<span className="i-back w-6 h-6" />
					</button>
				)}

				{/* Title */}
				<span className="w-full xl:w-auto">
					{showSidebar || !isMobile ? 'Admin Area' : location.pathname === '/dashboard' ? 'Dashboard' : dashboardTitle}
				</span>

				{/* Mobile emoji - only visible on small screens when not showing sidebar */}
				{!showSidebar && emoji && breakpoint !== 'xl' && (
					<span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xl select-none w-12 h-12 flex items-center justify-center xl:hidden">
						{emoji}
					</span>
				)}
			</h1>

			{/* Main container - responsive layout */}
			<div className="xl:flex xl:m-6 xl:gap-6 xl:container xl:max-h-[77vh] xl:overflow-auto">
				<div ref={parent} className="xl:flex xl:w-full xl:gap-6">
					{/* Sidebar - responsive behavior */}
					{(showSidebar || !isMobile) && (
						<aside className="w-full xl:w-[25%] overflow-auto xl:p-6 xl:border xl:border-black xl:rounded xl:max-h-full xl:bg-white">
							<div className="xl:space-y-2">
								{dashboardNavigation.map((section) => (
									<div key={section.title}>
										<h2 className="text-md font-heading bg-tertiary-black text-white px-4 py-2 text-[1.5rem] mb-0 xl:mb-2">
											{section.title}
										</h2>
										<nav className="space-y-2 p-4 xl:p-0">
											{section.title === 'SALES' && (
												<Link
													to="/dashboard"
													className="block p-4 xl:p-2 transition-colors font-bold border border-black bg-white rounded xl:border-0 xl:bg-transparent xl:rounded-none [aria-current='page']:bg-gray-200 [aria-current='page']:text-black hover:text-pink-500"
													onClick={handleSidebarItemClick}
													aria-current={matchRoute({ to: '/dashboard', fuzzy: true }) ? 'page' : undefined}
												>
													🛞 Dashboard
												</Link>
											)}
											{section.items.map((item) => {
												const isActive = matchRoute({ to: item.path, fuzzy: true })
												return (
													<Link
														key={item.path}
														to={item.path}
														className="block p-4 xl:p-2 transition-colors font-bold border border-black bg-white rounded xl:border-0 xl:bg-transparent xl:rounded-none data-[status=active]:bg-gray-200 data-[status=active]:text-black hover:text-pink-500"
														onClick={handleSidebarItemClick}
														data-status={isActive ? 'active' : 'inactive'}
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
					)}

					{/* Main content - responsive behavior */}
					{(!showSidebar || !isMobile) && (
						<ScrollArea className="w-full p-4 xl:flex-1 xl:p-8 xl:border xl:border-black xl:rounded xl:bg-white">
							<div className="p-4 bg-white border border-black rounded xl:p-0 xl:bg-transparent xl:border-0 xl:rounded-none">
								<Outlet />
							</div>
						</ScrollArea>
					)}
				</div>
			</div>
		</div>
	)
}
