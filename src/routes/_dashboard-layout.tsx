import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { dashboardNavigation } from '@/config/dashboardNavigation'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/utils'
import { useAmIAdmin } from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { uiStore, uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useLocation, useMatchRoute, useNavigate } from '@tanstack/react-router'
import React, { useState } from 'react'
import { UserWithAvatar } from '@/components/UserWithAvatar'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

// Custom hook to manage dashboard title using uiStore
export function useDashboardTitle(title: string) {
	React.useEffect(() => {
		uiActions.setDashboardTitle(title)
		return () => uiActions.setDashboardTitle('') // Reset to default on unmount
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

// Component to show when user is not authenticated
function LoginPrompt() {
	const handleLoginClick = () => {
		uiActions.openDialog('login')
	}

	return (
		<div className="flex items-center justify-center h-full">
			<div className="flex flex-col items-center space-y-4">
				<p className="text-lg text-muted-foreground">Please log in to view</p>
				<Button variant="primary" onClick={handleLoginClick}>
					Login
				</Button>
			</div>
		</div>
	)
}

function DashboardLayout() {
	const matchRoute = useMatchRoute()
	const navigate = useNavigate()
	const location = useLocation()
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md' || breakpoint === 'lg' // Changed: treat anything below xl (1024px) as mobile
	const [showSidebar, setShowSidebar] = useState(true)
	const [parent] = useAutoAnimate()
	const { dashboardTitle } = useStore(uiStore)
	const { isAuthenticated } = useStore(authStore)
	const isMessageDetailView =
		location.pathname.startsWith('/dashboard/sales/messages/') && location.pathname !== '/dashboard/sales/messages'

	// Admin checking
	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin } = useAmIAdmin(config?.appPublicKey)

	// Filter navigation based on admin status
	const filteredNavigation = React.useMemo(() => {
		if (isLoadingAdmin) return dashboardNavigation // Show all while loading

		return dashboardNavigation
			.filter((section) => !section.adminOnly || amIAdmin) // Filter out admin-only sections for non-admins
			.map((section) => ({
				...section,
				items: section.items.filter((item) => !item.adminOnly || amIAdmin), // Filter out admin-only items for non-admins
			}))
			.filter((section) => section.items.length > 0) // Remove empty sections
	}, [amIAdmin, isLoadingAdmin])

	// Simple emoji detection - match common emoji patterns at start
	const emojiRegex =
		/^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\uD83C][\uDF00-\uDFFF]|[\uD83D][\uDC00-\uDE4F]|[\uD83D][\uDE80-\uDEFF])\s*/
	const dashboardTitleWithoutEmoji = dashboardTitle.replace(emojiRegex, '')
	const dashboardEmoji = dashboardTitle.match(
		/^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\uD83C][\uDF00-\uDFFF]|[\uD83D][\uDC00-\uDE4F]|[\uD83D][\uDE80-\uDEFF])/,
	)?.[1]

	// Extract pubkey from pathname for message detail views
	const chatPubkey = isMessageDetailView ? location.pathname.split('/').pop() : null

	// Fetch profile data for chat header avatar
	const { data: chatProfile } = useQuery({
		queryKey: profileKeys.details(chatPubkey || ''),
		queryFn: () => fetchProfileByIdentifier(chatPubkey!),
		enabled: !!chatPubkey,
	})

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
			} else {
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
		<div className="lg:flex lg:flex-col lg:h-[calc(100vh-5rem)]">
			{/* Header - responsive for mobile/desktop */}
			<div className="lg:hidden sticky top-[8.5rem] z-10">
				<h1 className="font-heading p-4 bg-secondary-black text-secondary flex items-center gap-2 justify-center text-center relative">
					{/* Mobile back button - only visible on small screens when not showing sidebar */}
					{!showSidebar && isMobile && (
						<button
							onClick={handleBackToSidebar}
							className="flex items-center justify-center text-secondary focus:outline-none absolute left-2 sm:left-3 md:left-4 top-1/2 -translate-y-1/2 w-12 h-12 z-20"
							aria-label="Back to sidebar"
						>
							<span className="i-back w-6 h-6" />
						</button>
					)}

					{/* Title */}
					<span className="w-full truncate px-8 sm:px-12 md:px-16 text-3xl flex items-center justify-center gap-2 min-w-0">
						{showSidebar || !isMobile ? (
							'Dashboard'
						) : (
							<>
								{isMessageDetailView && chatProfile ? (
									<UserWithAvatar pubkey={chatProfile?.user?.pubkey || ''} size="md" showBadge={false} disableLink={true} />
								) : (
									<>
										{dashboardEmoji && <span className="text-2xl">{dashboardEmoji}</span>}
										<span className="truncate min-w-0 flex-1 text-center">{dashboardTitleWithoutEmoji}</span>
									</>
								)}
							</>
						)}
					</span>

					{/* Mobile emoji - only visible on small screens when not showing sidebar */}
					{!showSidebar && emoji && isMobile && !dashboardEmoji && (
						<span className="absolute right-2 sm:right-3 md:right-4 top-1/2 -translate-y-1/2 text-2xl select-none w-12 h-12 flex items-center justify-center z-20">
							{emoji}
						</span>
					)}
				</h1>
			</div>

			<div className="hidden lg:block">
				<h1 className="font-heading py-2 px-4 bg-secondary-black text-secondary flex items-center gap-2 justify-center text-center lg:justify-start relative">
					Dashboard
				</h1>
			</div>

			{/* Main container - responsive layout */}
			<div className="lg:flex lg:pt-6 lg:px-6 lg:pb-4 lg:gap-6 lg:flex-1 lg:overflow-hidden lg:max-w-none lg:min-h-0">
				<div ref={parent} className="lg:flex lg:w-full lg:gap-6">
					{/* Sidebar - responsive behavior */}
					{(showSidebar || !isMobile) && (
						<aside className="w-full lg:w-80 lg:overflow-y-auto lg:border lg:border-black lg:rounded lg:max-h-full lg:bg-white lg:flex-shrink-0">
							<div className="lg:space-y-2">
								{filteredNavigation.map((section) => (
									<div key={section.title}>
										<h3 className="font-heading bg-tertiary-black text-white px-4 py-2 mb-0 lg:mb-2">{section.title}</h3>
										<nav className="space-y-2 p-4 lg:p-0 text-xl lg:text-base">
											{section.items.map((item) => {
												const isActive = matchRoute({ to: item.path, fuzzy: true })
												return (
													<Link
														key={item.path}
														to={item.path}
														className="block p-4 lg:px-6 lg:py-2 transition-colors font-bold border border-black bg-white rounded lg:border-0 lg:bg-transparent lg:rounded-none data-[status=active]:bg-secondary data-[status=active]:text-white data-[status=active]:border-secondary hover:text-pink-500"
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
						<div
							className={`w-full lg:flex-1 lg:max-w-4xl lg:border lg:border-black lg:rounded lg:bg-white flex flex-col lg:max-h-full lg:overflow-hidden ${
								isMessageDetailView && isMobile ? 'h-[calc(100vh-8.5rem)]' : ''
							}`}
						>
							{/* Desktop back button and title - fixed to top of container */}
							{needsBackButton && (
								<div className="sticky top-0 z-10 bg-white border-b border-gray-200 pb-4 mb-0 p-4 lg:p-8 flex-shrink-0 flex items-center relative">
									<button
										onClick={handleBackToParent}
										className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
										aria-label={`Back to ${backButtonInfo?.parentTitle}`}
									>
										<span className="i-back w-5 h-5" />
										<span className="text-sm font-medium">Back to {backButtonInfo?.parentTitle}</span>
									</button>

									{!isMobile && (
										<h1 className="absolute left-1/2 -translate-x-1/2 text-[1.6rem] font-bold flex items-center gap-2">
											{isMessageDetailView && chatProfile?.user?.pubkey && (
												<UserWithAvatar pubkey={chatProfile?.user?.pubkey} size="md" showBadge={false} disableLink={true} />
											)}
											{dashboardTitle}
										</h1>
									)}
								</div>
							)}

							<div className="flex-1 min-h-0 lg:overflow-y-auto">
								{isMessageDetailView ? (
									<div className="h-full">{!isAuthenticated ? <LoginPrompt /> : <Outlet />}</div>
								) : (
									<div className="h-full">
										<div
											className={cn(
												'p-4 bg-white lg:p-8 lg:bg-transparent h-full',
												location.pathname === '/dashboard/sales/sales' && 'p-0 lg:p-0',
												location.pathname.startsWith('/dashboard/sales/messages') && 'p-0 lg:p-0',
												location.pathname === '/dashboard/sales/circular-economy' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/products' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/collections' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/migration-tool' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/receiving-payments' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/shipping-options' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/profile' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/making-payments' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/your-purchases' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/network' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/app-settings/app-miscelleneous' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/app-settings/team' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/app-settings/blacklists' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/app-settings/featured-items' && 'p-0 lg:p-0',
											)}
										>
											{/* Only show title here if there's no back button */}
											{!isMobile &&
												!needsBackButton &&
												location.pathname !== '/dashboard' &&
												location.pathname !== '/dashboard/sales/sales' &&
												!location.pathname.startsWith('/dashboard/sales/messages') &&
												location.pathname !== '/dashboard/sales/circular-economy' &&
												location.pathname !== '/dashboard/products/products' &&
												location.pathname !== '/dashboard/products/collections' &&
												location.pathname !== '/dashboard/products/migration-tool' &&
												location.pathname !== '/dashboard/products/receiving-payments' &&
												location.pathname !== '/dashboard/products/shipping-options' &&
												location.pathname !== '/dashboard/account/profile' &&
												location.pathname !== '/dashboard/account/making-payments' &&
												location.pathname !== '/dashboard/account/your-purchases' &&
												location.pathname !== '/dashboard/app-settings/app-miscelleneous' &&
												location.pathname !== '/dashboard/app-settings/team' &&
												location.pathname !== '/dashboard/app-settings/blacklists' &&
												location.pathname !== '/dashboard/app-settings/featured-items' &&
												location.pathname !== '/dashboard/account/network' && (
													<h1 className="text-[1.6rem] font-bold mb-4">{dashboardTitle}</h1>
												)}
											{!isAuthenticated ? (
												<LoginPrompt />
											) : (
												<>
													{/* Only show title here if there's no back button */}
													{!isMobile &&
														!needsBackButton &&
														location.pathname !== '/dashboard/sales/sales' &&
														!location.pathname.startsWith('/dashboard/sales/messages') &&
														location.pathname !== '/dashboard/app-settings/app-miscelleneous' &&
														location.pathname !== '/dashboard/app-settings/team' &&
														location.pathname !== '/dashboard/app-settings/blacklists' &&
														location.pathname !== '/dashboard/app-settings/featured-items' &&
														location.pathname !== '/dashboard/sales/circular-economy' &&
														location.pathname !== '/dashboard/products/products' &&
														location.pathname !== '/dashboard/products/collections' &&
														location.pathname !== '/dashboard/products/migration-tool' &&
														location.pathname !== '/dashboard/products/receiving-payments' &&
														location.pathname !== '/dashboard/products/shipping-options' &&
														location.pathname !== '/dashboard/account/profile' &&
														location.pathname !== '/dashboard/account/making-payments' &&
														location.pathname !== '/dashboard/account/your-purchases' &&
														location.pathname !== '/dashboard/account/network' && (
															<h1 className="text-[1.6rem] font-bold mb-4">{dashboardTitle}</h1>
														)}
													<Outlet />
												</>
											)}
										</div>
									</div>
								)}
								{/* Always render Outlet invisibly to ensure dashboard titles get set */}
								{!isAuthenticated && (
									<div className="hidden">
										<Outlet />
									</div>
								)}
							</div>
						</div>
					)}

					{/* Placeholder Container - responsive on desktop */}
					{!isMobile && (
						<div className="hidden min-[1470px]:block lg:min-w-0 lg:flex-1 lg:max-w-32 xl:max-w-48 2xl:max-w-64 lg:border lg:border-black lg:rounded bg-white lg:max-h-full lg:overflow-hidden lg:shadow-md">
							<div className="p-4 lg:px-6 lg:py-4 flex items-center justify-center h-full">
								<span className="text-3xl">₿</span>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
