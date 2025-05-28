import React, { useState, createContext, useContext } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { dashboardNavigation } from '@/config/dashboardNavigation'
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
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

function DashboardLayout() {
	const matchRoute = useMatchRoute()
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm'
	const [showSidebar, setShowSidebar] = useState(true)
	const [parent] = useAutoAnimate()
	const [title, setTitle] = useState('DASHBOARD')

	// When route changes on mobile, show main content
	React.useEffect(() => {
		if (isMobile) {
			setShowSidebar(false)
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [matchRoute])

	const handleSidebarItemClick = () => {
		if (isMobile) setShowSidebar(false)
	}

	const handleBackToSidebar = () => {
		if (isMobile) setShowSidebar(true)
	}

	if (isMobile) {
		return (
			<DashboardTitleContext.Provider value={{ title, setTitle }}>
				<div>
					<h1 className="font-heading p-4 bg-black text-secondary flex items-center gap-2 justify-center text-center" style={{ fontSize: '2rem' }}>
						{!showSidebar && (
							<button
								onClick={handleBackToSidebar}
								className="flex items-center justify-center text-secondary focus:outline-none absolute left-2"
								style={{ width: 48, height: 48 }}
								aria-label="Back to sidebar"
							>
								<span className="i-back w-6 h-6" />
							</button>
						)}
						<span className="w-full">{showSidebar ? 'DASHBOARD' : title}</span>
					</h1>
					<div className="container" ref={parent}>
						{showSidebar ? (
							// Sidebar only
							<aside className="w-full p-6 overflow-auto">
								<div className="space-y-8">
									{dashboardNavigation.map((section) => (
										<div key={section.title}>
											<h2 className="text-md font-heading mb-2 bg-black text-white px-4 py-2">{section.title}</h2>
											<nav className="space-y-2">
												{section.items.map((item) => {
													// On mobile sidebar view, never show active status
													const isActive = !showSidebar ? matchRoute({ to: item.path, fuzzy: true }) : false
													return (
														<Link
															key={item.path}
															to={item.path}
															className={`block p-2 transition-colors font-bold ${isActive ? 'bg-gray-200 text-black' : 'hover:text-pink-500'}`}
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
							<ScrollArea className="w-full p-8">
								<Outlet />
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
			<h1 className="text-2xl font-heading p-4 bg-black text-secondary">DASHBOARD</h1>

			<div className="flex m-6 gap-6 container max-h-[77vh] overflow-auto">
				{/* Sidebar */}
				<aside className="w-[25%] p-6 border-2 border-black">
					<div className="space-y-8">
						{dashboardNavigation.map((section) => (
							<div key={section.title}>
								<h2 className="text-md font-heading mb-2 bg-black text-white px-4 py-2">{section.title}</h2>
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
						<Link to="/dashboard" className="inline-block px-2 py-2 bg-black text-white hover:bg-gray-800 transition-colors">
							<span className="i-back w-6 h-6" />
						</Link>
					</div>
					<Outlet />
				</ScrollArea>
			</div>
		</div>
	)
}
