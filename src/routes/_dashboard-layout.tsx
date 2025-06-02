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
	const isMobile = breakpoint !== 'xl'
	const isDesktop = breakpoint === 'xl'
	const [showSidebar, setShowSidebar] = useState(true)
	const [parent] = useAutoAnimate()
	const { dashboardTitle } = useStore(uiStore)

	// When route changes on mobile, show sidebar for /dashboard, main content otherwise
	React.useEffect(() => {
		if (isMobile) {
			setShowSidebar(location.pathname === '/dashboard')
		}
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

	// Computed styles based on breakpoint
	const headerClasses = `font-heading ${isDesktop ? 'p-4' : 'p-2'} bg-secondary-black text-secondary flex items-center gap-2 ${isDesktop ? 'justify-start text-2xl' : 'justify-center text-center text-[2rem]'} relative`
	
	const mainContainerClasses = isDesktop 
		? 'flex m-6 gap-6 container max-h-[77vh] overflow-auto' 
		: ''
	
	const innerContainerClasses = isDesktop ? 'flex w-full gap-6' : ''
	
	const sidebarClasses = isDesktop 
		? 'w-[25%] overflow-auto p-6 border border-black rounded max-h-full bg-white' 
		: 'w-full overflow-auto'
	
	const sidebarInnerClasses = isDesktop ? 'space-y-2' : ''
	
	const sectionHeaderClasses = `text-md font-heading bg-tertiary-black text-white px-4 py-2 text-[1.5rem] ${isDesktop ? 'mb-2' : 'mb-0'}`
	
	const navClasses = isDesktop ? 'space-y-2' : 'space-y-2 p-4'
	
	const getLinkClasses = (isActive: boolean) => {
		const baseClasses = 'block transition-colors font-bold'
		const mobileClasses = 'p-4 border border-black bg-white rounded'
		const desktopClasses = 'p-2 border-0 bg-transparent rounded-none'
		const activeClasses = 'bg-gray-200 text-black'
		const inactiveClasses = 'hover:text-pink-500'
		
		return `${baseClasses} ${isDesktop ? desktopClasses : mobileClasses} ${isActive ? activeClasses : inactiveClasses}`
	}
	
	const scrollAreaClasses = isDesktop 
		? 'w-full flex-1 p-8 border border-black rounded bg-white' 
		: 'w-full p-4'
	
	const contentWrapperClasses = isDesktop 
		? 'p-0 bg-transparent border-0 rounded-none' 
		: 'p-4 bg-white border border-black rounded'

	return (
		<div>
			{/* Header - responsive for mobile/desktop */}
			<h1 className={headerClasses}>
				{/* Mobile back button */}
				{!showSidebar && !isDesktop && (
					<button
						onClick={handleBackToSidebar}
						className="flex items-center justify-center text-secondary focus:outline-none absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12"
						aria-label="Back to sidebar"
					>
						<span className="i-back w-6 h-6" />
					</button>
				)}

				{/* Title */}
				<span className={isDesktop ? 'w-auto' : 'w-full'}>
					{showSidebar || !isMobile ? 'Admin Area' : location.pathname === '/dashboard' ? 'Dashboard' : dashboardTitle}
				</span>

				{/* Mobile emoji */}
				{!showSidebar && emoji && !isDesktop && (
					<span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xl select-none w-12 h-12 flex items-center justify-center">
						{emoji}
					</span>
				)}
			</h1>

			{/* Main container */}
			<div className={mainContainerClasses}>
				<div ref={parent} className={innerContainerClasses}>
					{/* Sidebar */}
					{(showSidebar || !isMobile) && (
						<aside className={sidebarClasses}>
							<div className={sidebarInnerClasses}>
								{dashboardNavigation.map((section) => (
									<div key={section.title}>
										<h2 className={sectionHeaderClasses}>
											{section.title}
										</h2>
										<nav className={navClasses}>
											{section.title === 'SALES' && (
												<Link
													to="/dashboard"
													className={getLinkClasses(location.pathname === '/dashboard')}
													onClick={handleSidebarItemClick}
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
														className={getLinkClasses(isActive)}
														onClick={handleSidebarItemClick}
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

					{/* Main content */}
					{(!showSidebar || !isMobile) && (
						<ScrollArea className={scrollAreaClasses}>
							<div className={contentWrapperClasses}>
								<Outlet />
							</div>
						</ScrollArea>
					)}
				</div>
			</div>
		</div>
	)
}
