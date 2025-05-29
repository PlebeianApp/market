import React, { useState, createContext, useContext } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { dashboardNavigation } from '@/config/dashboardNavigation'
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate, useLocation } from '@tanstack/react-router'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAutoAnimate } from '@formkit/auto-animate/react'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

// Dashboard title context
const DashboardTitleContext = createContext({ title: 'DASHBOARD', setTitle: (t: string) => {} })
export function useDashboardTitle(title: string) {
	const ctx = useContext(DashboardTitleContext)
	React.useEffect(() => {
		ctx.setTitle(title)
		return () => ctx.setTitle('DASHBOARD')
	}, [title])
}

// Helper to get emoji for current route
function getCurrentEmoji(showSidebar: boolean, currentPath: string): string | null {
	if (showSidebar) return null
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
	const isMobile = breakpoint === 'sm'
	const [showSidebar, setShowSidebar] = useState(true)
	const [parent] = useAutoAnimate()
	const [title, setTitle] = useState('DASHBOARD')

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

	if (isMobile) {
		const emoji = getCurrentEmoji(showSidebar, typeof window !== 'undefined' ? window.location.pathname : '')
		return (
			<DashboardTitleContext.Provider value={{ title, setTitle }}>
				<div className="relative">
					<h1 className="font-heading p-2 bg-dashboard-header text-secondary flex items-center gap-2 justify-center text-center relative" style={{ fontSize: '2rem' }}>
						{!showSidebar && (
							<button
								onClick={handleBackToSidebar}
								className="flex items-center justify-center text-secondary focus:outline-none absolute left-2 top-1/2 -translate-y-1/2"
								style={{ width: 48, height: 48 }}
								aria-label="Back to sidebar"
							>
								<span className="i-back w-6 h-6" />
							</button>
						)}
						<span className="w-full">{showSidebar ? 'Admin Area' : title}</span>
						{!showSidebar && emoji && (
							<span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xl select-none" style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{emoji}</span>
						)}
					</h1>
					<div className="container" ref={parent}>
						{showSidebar ? (
							// Sidebar only
							<aside className="w-full overflow-auto">
								<div>
									{dashboardNavigation.map((section) => (
										<div key={section.title}>
											<h2 className={`text-md font-heading bg-dashboard-section text-white px-4 py-2${!isMobile ? ' mb-2' : ''}`} style={{ fontSize: '1.5rem' }}>{section.title}</h2>
											<nav className="space-y-2 p-4">
												{section.title === 'SALES' && (
													<Link
														to="/dashboard"
														className={`block ${isMobile ? 'p-4' : 'p-2'} transition-colors font-bold${isMobile ? ' border border-black bg-white' : ''} ${location.pathname === '/dashboard' ? 'bg-gray-200 text-black' : 'hover:text-pink-500'}`}
														onClick={handleSidebarItemClick}
													>
														🛞 Dashboard
													</Link>
												)}
												{section.items.map((item) => {
													// On mobile sidebar view, never show active status
													const isActive = !showSidebar ? matchRoute({ to: item.path, fuzzy: true }) : false
													return (
														<Link
															key={item.path}
															to={item.path}
															className={`block ${isMobile ? 'p-4' : 'p-2'} transition-colors font-bold${isMobile ? ' border border-black bg-white' : ''} ${isActive ? 'bg-gray-200 text-black' : 'hover:text-pink-500'}`}
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
						) : (
							// Main content only
							<ScrollArea className="w-full p-4">
								<div className="p-4 bg-white border border-black rounded-[4px]">
									<Outlet />
								</div>
							</ScrollArea>
						)}
					</div>
				</div>
			</DashboardTitleContext.Provider>
		)
	}

	// Desktop layout (unchanged)
	return (
		<div>
			<h1 className="text-2xl font-heading p-4 bg-dashboard-header text-secondary">Admin Area</h1>

			<div className="flex m-6 gap-6 container max-h-[77vh] overflow-auto">
				{/* Sidebar */}
				<aside className="w-[25%] p-6 border-2 border-black overflow-y-auto max-h-full bg-white">
					<div className="space-y-2">
						{dashboardNavigation.map((section) => (
							<div key={section.title}>
								<h2 className={`text-md font-heading bg-dashboard-section text-white px-4 py-2${!isMobile ? ' mb-2' : ''}`} style={{ fontSize: '1.5rem' }}>{section.title}</h2>
								<nav className="space-y-2">
									{section.title === 'SALES' && (
										<Link
											to="/dashboard"
											className={`block ${isMobile ? 'p-4' : 'p-2'} transition-colors font-bold${isMobile ? ' border border-black bg-white' : ''} ${location.pathname === '/dashboard' ? 'bg-gray-200 text-black' : 'hover:text-pink-500'}`}
										>
											🛞 Dashboard
										</Link>
									)}
									{section.items.map((item) => {
										const isActive = matchRoute({
											to: item.path,
											fuzzy: true,
										})
										return (
											<Link
												key={item.path}
												to={item.path}
												className={`block ${isMobile ? 'p-4' : 'p-2'} transition-colors font-bold${isMobile ? ' border border-black bg-white' : ''} ${isActive ? 'bg-gray-200 text-black' : 'hover:text-pink-500'}`}
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
				<ScrollArea className="flex-1 p-8 border-2 border-black bg-white">
					<Outlet />
				</ScrollArea>
			</div>
		</div>
	)
}
