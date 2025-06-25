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

// Configuration for pages that need back buttons
const backButtonRoutes: Record<string, { parentPath: string; parentTitle: string }> = {
	'/dashboard/products/products/new': {
		parentPath: '/dashboard/products/products',
		parentTitle: '📦 Products',
	},
	// Dynamic route for editing products
	'/dashboard/products/products/': {
		parentPath: '/dashboard/products/products',
		parentTitle: '📦 Products',
	},
	'/dashboard/products/collections/new': {
		parentPath: '/dashboard/products/collections',
		parentTitle: '🗂️ Collections',
	},
	// Dynamic route for editing collections
	'/dashboard/products/collections/': {
		parentPath: '/dashboard/products/collections',
		parentTitle: '🗂️ Collections',
	},
	// Dynamic route for order details
	'/dashboard/orders/': {
		parentPath: '/dashboard/sales/sales',
		parentTitle: '💰 Sales',
	},
	// Dynamic route for message details
	'/dashboard/sales/messages/': {
		parentPath: '/dashboard/sales/messages',
		parentTitle: '✉️ Messages',
	},
}

// Helper to check if current route needs a back button
function getBackButtonInfo(currentPath: string): { parentPath: string; parentTitle: string } | null {
	// Check exact matches first
	if (backButtonRoutes[currentPath]) {
		return backButtonRoutes[currentPath]
	}
	
	// Check for product edit pages (pattern: /dashboard/products/products/[productId])
	if (currentPath.startsWith('/dashboard/products/products/') && currentPath !== '/dashboard/products/products') {
		return backButtonRoutes['/dashboard/products/products/']
	}
	
	// Check for collection edit pages (pattern: /dashboard/products/collections/[collectionId])
	if (currentPath.startsWith('/dashboard/products/collections/') && currentPath !== '/dashboard/products/collections') {
		return backButtonRoutes['/dashboard/products/collections/']
	}
	
	// Check for order detail pages (pattern: /dashboard/orders/[orderId])
	if (currentPath.startsWith('/dashboard/orders/') && currentPath !== '/dashboard/orders') {
		return backButtonRoutes['/dashboard/orders/']
	}
	
	// Check for message detail pages (pattern: /dashboard/sales/messages/[pubkey])
	if (currentPath.startsWith('/dashboard/sales/messages/') && currentPath !== '/dashboard/sales/messages') {
		return backButtonRoutes['/dashboard/sales/messages/']
	}
	
	return null
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
	const isMobile = breakpoint !== 'xl' // Changed: treat anything below xl (1280px) as mobile
	const [showSidebar, setShowSidebar] = useState(true)
	const [parent] = useAutoAnimate()
	const { dashboardTitle } = useStore(uiStore)

	// Check if current route needs a back button
	const backButtonInfo = getBackButtonInfo(location.pathname)
	const needsBackButton = !!backButtonInfo && !isMobile

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
			// Check if we're on a product creation/edit page and navigate accordingly
			if (location.pathname.startsWith('/dashboard/products/products/')) {
				navigate({ to: '/dashboard/products/products' })
			} 
			// Check if we're on a collection creation/edit page and navigate accordingly
			else if (location.pathname.startsWith('/dashboard/products/collections/')) {
				navigate({ to: '/dashboard/products/collections' })
			}
			// Check if we're on an order detail page and navigate accordingly
			else if (location.pathname.startsWith('/dashboard/orders/')) {
				navigate({ to: '/dashboard/sales/sales' })
			}
			// Check if we're on a message detail page and navigate accordingly
			else if (location.pathname.startsWith('/dashboard/sales/messages/') && location.pathname !== '/dashboard/sales/messages') {
				navigate({ to: '/dashboard/sales/messages' })
			}
			else {
				// Default behavior - back to dashboard
				setShowSidebar(true)
				navigate({ to: '/dashboard' })
			}
		}
	}

	const handleBackToParent = () => {
		if (backButtonInfo) {
			navigate({ to: backButtonInfo.parentPath })
		}
	}

	const emoji = getCurrentEmoji(showSidebar, typeof window !== 'undefined' ? window.location.pathname : '')

	return (
		<div className="lg:block">
			{/* Header - responsive for mobile/desktop */}
			<h1 className="font-heading p-4 bg-secondary-black text-secondary flex items-center gap-2 justify-center text-center lg:justify-start relative">
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
				<span className="w-full lg:w-auto text-3xl lg:text-3xl">{showSidebar || !isMobile ? 'Admin Area' : dashboardTitle}</span>

				{/* Mobile emoji - only visible on small screens when not showing sidebar */}
				{!showSidebar && emoji && breakpoint !== 'xl' && (
					<span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xl select-none w-12 h-12 flex items-center justify-center xl:hidden">
						{emoji}
					</span>
				)}
			</h1>

			{/* Main container - responsive layout */}
			<div className="lg:flex lg:m-6 lg:gap-6 lg:container lg:max-h-[77vh] lg:overflow-auto">
				<div ref={parent} className="lg:flex lg:w-full lg:gap-6">
					{/* Sidebar - responsive behavior */}
					{(showSidebar || !isMobile) && (
						<aside className="w-full lg:w-[25%] overflow-auto lg:p-6 lg:border lg:border-black lg:rounded lg:max-h-full lg:bg-white">
							<div className="lg:space-y-2">
								{dashboardNavigation.map((section) => (
									<div key={section.title}>
										<h3 className="font-heading bg-tertiary-black text-white px-4 py-2 mb-0 lg:mb-2">{section.title}</h3>
										<nav className="space-y-2 p-4 lg:p-0 text-xl lg:text-base">
											{section.items.map((item) => {
												const isActive = matchRoute({ to: item.path, fuzzy: true })
												return (
													<Link
														key={item.path}
														to={item.path}
														className="block p-4 lg:p-2 transition-colors font-bold border border-black bg-white rounded lg:border-0 lg:bg-transparent lg:rounded-none data-[status=active]:bg-gray-200 data-[status=active]:text-black hover:text-pink-500"
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
						<div className="w-full p-4 lg:flex-1 lg:p-8 lg:border lg:border-black lg:rounded lg:bg-white flex flex-col">
							{/* Desktop back button and title - fixed to top of container */}
							{needsBackButton && (
								<div className="sticky top-0 z-10 bg-white border-b border-gray-200 pb-4 mb-4 -mx-8 px-8 -mt-8 pt-8 flex-shrink-0 flex items-center relative">
									<button
										onClick={handleBackToParent}
										className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
										aria-label={`Back to ${backButtonInfo?.parentTitle}`}
									>
										<span className="i-back w-5 h-5" />
										<span className="text-sm font-medium">Back to {backButtonInfo?.parentTitle}</span>
									</button>
									
									{!isMobile && (
										<h1 className="absolute left-1/2 -translate-x-1/2 text-[1.6rem] font-bold">
											{dashboardTitle}
										</h1>
									)}
								</div>
							)}
							
							<ScrollArea className="flex-1 min-h-0">
								<div className="p-4 bg-white border border-black rounded lg:p-0 lg:bg-transparent lg:border-0 lg:rounded-none">
									{/* Only show title here if there's no back button */}
									{!isMobile && !needsBackButton && <h1 className="text-[1.6rem] font-bold">{dashboardTitle}</h1>}
									<Outlet />
								</div>
							</ScrollArea>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
