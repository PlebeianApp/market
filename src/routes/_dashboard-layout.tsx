import React, { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { dashboardNavigation } from '@/config/dashboardNavigation'
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate, useLocation } from '@tanstack/react-router'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { uiStore, uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useQuery } from '@tanstack/react-query'
import { profileKeys } from '@/queries/queryKeyFactory'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { MessageSquareText } from 'lucide-react'
import { dashboardActions } from '@/lib/stores/dashboard'
import { DashboardSettingsModal } from '@/components/dashboard/DashboardSettingsModal'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_dashboard-layout')({
	component: DashboardLayout,
})

// Settings gear icon
function GearIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 122.88 122.878"
			className={className}
			aria-hidden="true"
		>
			<g>
				<path
					fill="currentColor"
					fillRule="evenodd"
					clipRule="evenodd"
					d="M101.589,14.7l8.818,8.819c2.321,2.321,2.321,6.118,0,8.439l-7.101,7.101 c1.959,3.658,3.454,7.601,4.405,11.752h9.199c3.283,0,5.969,2.686,5.969,5.968V69.25c0,3.283-2.686,5.969-5.969,5.969h-10.039 c-1.231,4.063-2.992,7.896-5.204,11.418l6.512,6.51c2.321,2.323,2.321,6.12,0,8.44l-8.818,8.819c-2.321,2.32-6.119,2.32-8.439,0 l-7.102-7.102c-3.657,1.96-7.601,3.456-11.753,4.406v9.199c0,3.282-2.685,5.968-5.968,5.968H53.629 c-3.283,0-5.969-2.686-5.969-5.968v-10.039c-4.063-1.232-7.896-2.993-11.417-5.205l-6.511,6.512c-2.323,2.321-6.12,2.321-8.441,0 l-8.818-8.818c-2.321-2.321-2.321-6.118,0-8.439l7.102-7.102c-1.96-3.657-3.456-7.6-4.405-11.751H5.968 C2.686,72.067,0,69.382,0,66.099V53.628c0-3.283,2.686-5.968,5.968-5.968h10.039c1.232-4.063,2.993-7.896,5.204-11.418l-6.511-6.51 c-2.321-2.322-2.321-6.12,0-8.44l8.819-8.819c2.321-2.321,6.118-2.321,8.439,0l7.101,7.101c3.658-1.96,7.601-3.456,11.753-4.406 V5.969C50.812,2.686,53.498,0,56.78,0h12.471c3.282,0,5.968,2.686,5.968,5.969v10.036c4.064,1.231,7.898,2.992,11.422,5.204 l6.507-6.509C95.471,12.379,99.268,12.379,101.589,14.7L101.589,14.7z M61.44,36.92c13.54,0,24.519,10.98,24.519,24.519 c0,13.538-10.979,24.519-24.519,24.519c-13.539,0-24.519-10.98-24.519-24.519C36.921,47.9,47.901,36.92,61.44,36.92L61.44,36.92z"
				/>
			</g>
		</svg>
	)
}

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
		parentPath: '/dashboard/dashboard',
		parentTitle: '📊 Dashboard',
	},
	// Dynamic route for message details
	'/dashboard/sales/messages/': {
		parentPath: '/dashboard/dashboard',
		parentTitle: '📊 Dashboard',
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
				<Button onClick={handleLoginClick} className="bg-neutral-800 hover:bg-neutral-700 text-white">
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
	// Use auto-animate with error handling to prevent DOM manipulation errors
	const [parent] = (() => {
		try {
			return useAutoAnimate()
		} catch (error) {
			console.warn('Auto-animate not available:', error)
			return [null]
		}
	})()
	const { dashboardTitle } = useStore(uiStore)
	const { isAuthenticated } = useStore(authStore)
	const isMessageDetailView =
		location.pathname.startsWith('/dashboard/sales/messages/') && location.pathname !== '/dashboard/sales/messages'

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

	// Determine back target
	const searchState = (location.search as unknown as { from?: string }) || {}
	let backInfoToUse = getBackButtonInfo(location.pathname)
	if (searchState?.from === 'sales') {
		backInfoToUse = { parentPath: '/dashboard/sales/sales', parentTitle: '💰 Sales' }
	} else if (searchState?.from === 'messages') {
		backInfoToUse = { parentPath: '/dashboard/sales/messages', parentTitle: '✉️ Messages' }
	} else if (searchState?.from === 'dashboard') {
		backInfoToUse = { parentPath: '/dashboard/dashboard', parentTitle: '📊 Dashboard' }
	}
	const needsBackButton = !!backInfoToUse && !isMobile

	// When route changes on mobile, show sidebar for /dashboard, main content otherwise
	React.useEffect(() => {
		if (isMobile) {
			if (location.pathname === '/dashboard' || location.pathname === '/dashboard/dashboard') {
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
			// Prefer explicit source state when available
			const searchState = (location.search as unknown as { from?: string }) || {}
			if (searchState?.from === 'sales') {
				navigate({ to: '/dashboard/sales/sales' })
				return
			}
			if (searchState?.from === 'messages') {
				navigate({ to: '/dashboard/sales/messages' })
				return
			}
			if (searchState?.from === 'dashboard') {
				setShowSidebar(true)
				navigate({ to: '/dashboard/dashboard' })
				return
			}

			// Fallback to path-based heuristics
			if (location.pathname.startsWith('/dashboard/products/products/')) {
				navigate({ to: '/dashboard/products/products' })
			} else if (location.pathname.startsWith('/dashboard/products/collections/')) {
				navigate({ to: '/dashboard/products/collections' })
			} else if (location.pathname.startsWith('/dashboard/orders/')) {
				navigate({ to: '/dashboard/sales/sales' })
			} else if (location.pathname.startsWith('/dashboard/sales/messages/') && location.pathname !== '/dashboard/sales/messages') {
				navigate({ to: '/dashboard/sales/messages' })
			} else {
				setShowSidebar(true)
				navigate({ to: '/dashboard/dashboard' })
			}
		}
	}

	const handleBackToParent = () => {
		if (backInfoToUse) {
			navigate({ to: backInfoToUse.parentPath })
		}
	}

	const emoji = getCurrentEmoji(showSidebar, typeof window !== 'undefined' ? window.location.pathname : '')

	return (
		<div className="lg:flex lg:flex-col lg:h-[calc(100vh-5rem)] lg:overflow-hidden">
			{/* Header - responsive for mobile/desktop */}
			<div className="lg:hidden sticky top-[9.5rem] lg:top-[5rem] z-10">
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
									<>
										<Avatar className="h-8 w-8 flex-shrink-0">
											<AvatarImage src={chatProfile.profile?.picture} />
											<AvatarFallback>
												{(chatProfile.profile?.name || chatProfile.profile?.displayName || chatPubkey?.slice(0, 1))?.charAt(0).toUpperCase()}
											</AvatarFallback>
										</Avatar>
										<span className="truncate min-w-0 flex-1 text-center">{dashboardTitleWithoutEmoji}</span>
									</>
								) : (
									<>
										{dashboardEmoji && <span className="text-2xl flex-shrink-0">{dashboardEmoji}</span>}
										<span className="truncate min-w-0 flex-1 text-center">{dashboardTitleWithoutEmoji}</span>
									</>
								)}
							</>
						)}
					</span>

					{/* Mobile settings icon when on dashboard */}
					{!showSidebar && isMobile && location.pathname === '/dashboard/dashboard' && (
						<button
							onClick={dashboardActions.openSettings}
							aria-label="Customize dashboard widgets"
							className="absolute right-2 sm:right-3 md:right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-black hover:opacity-70 transition-opacity z-20"
						>
							<GearIcon className="w-6 h-6" />
						</button>
					)}

					{/* Mobile emoji - only visible on small screens when not showing sidebar and not on dashboard */}
					{!showSidebar && emoji && isMobile && !dashboardEmoji && location.pathname !== '/dashboard/dashboard' && (
						<span className="absolute right-2 sm:right-3 md:right-4 top-1/2 -translate-y-1/2 text-2xl select-none w-12 h-12 flex items-center justify-center z-20">
							{emoji}
						</span>
					)}
				</h1>
			</div>

			{/* Desktop title intentionally omitted on dashboard */}

			{/* Main container - responsive layout */}
			<div className="lg:flex lg:p-6 lg:gap-6 lg:flex-1 lg:overflow-hidden lg:max-w-none lg:min-h-0 bg-layer-base">
				<div className="lg:flex lg:w-full lg:gap-6 lg:min-w-0">
					{/* Sidebar - responsive behavior */}
					{(showSidebar || !isMobile) && (
						<aside className="w-full lg:w-80 lg:overflow-y-auto lg:border lg:border-black lg:rounded lg:max-h-full bg-layer-elevated lg:flex-shrink-0 lg:shadow-md">
							<div ref={parent} className="lg:space-y-2">
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
                                                        className="block p-4 lg:px-6 lg:py-2 transition-colors font-bold border border-black fg-layer-elevated rounded lg:border-0 lg:bg-transparent lg:rounded-none lg:data-[status=active]:bg-secondary lg:data-[status=active]:text-white lg:data-[status=active]:border-secondary hover:text-pink-500"
														onClick={handleSidebarItemClick}
														data-status={isActive ? 'active' : 'inactive'}
													>
														<span className="inline-flex items-center gap-2 w-full">
															<span className="flex-1 text-left">{item.title}</span>
															{/* Desktop settings icon on Dashboard link */}
															{item.path === '/dashboard/dashboard' && !isMobile && (
																<button
																	type="button"
																	onClick={(e) => {
																		e.preventDefault()
																		e.stopPropagation()
																		dashboardActions.openSettings()
																	}}
																	aria-label="Customize dashboard widgets"
																	className="inline-flex items-center justify-center h-6 w-6 text-black hover:opacity-70 transition-opacity"
																>
																	<GearIcon className="h-4 w-4" />
																</button>
															)}
														</span>
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
                            className={`w-full lg:flex-1 ${
								location.pathname === '/dashboard/dashboard' 
									? 'lg:max-w-none' 
									: 'lg:max-w-4xl'
							} lg:h-[calc(100vh-5rem-1.5rem)] border border-black lg:rounded bg-layer-elevated flex flex-col lg:max-h-full lg:overflow-hidden lg:shadow-md ${
								isMessageDetailView && isMobile ? 'h-[calc(100vh-5rem)]' : ''
							}`}
						>
							{/* Desktop back button and title - fixed to top of container */}
															{needsBackButton && (
							<div className="sticky top-0 z-10 fg-layer-elevated border-b border-layer-subtle pb-4 mb-0 p-4 lg:p-8 flex-shrink-0 flex items-center justify-between relative">
							<button
								onClick={() => navigate({ to: backInfoToUse!.parentPath })}
								className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
								aria-label={`Back to ${backInfoToUse?.parentTitle}`}
							>
								<span className="i-back w-5 h-5" />
								<span className="text-sm font-medium">Back to {backInfoToUse?.parentTitle}</span>
							</button>

							{!isMobile && isMessageDetailView && chatProfile && (
								<div className="flex items-center gap-2 min-w-0">
									<Avatar className="h-6 w-6 flex-shrink-0">
										<AvatarImage src={chatProfile.profile?.picture} />
										<AvatarFallback>
											{(chatProfile.profile?.name || chatProfile.profile?.displayName || chatPubkey?.slice(0, 1))?.charAt(0).toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<span className="text-sm font-medium truncate min-w-0">{dashboardTitleWithoutEmoji}</span>
								</div>
							)}
						</div>
					)}

                            <div className={cn(
                                'flex-1 min-h-0',
                                location.pathname === '/dashboard/dashboard'
                                    ? 'lg:overflow-hidden overflow-y-auto'
                                    : 'lg:overflow-y-auto',
                            )}>
								{isMessageDetailView ? (
									<div className="h-full">{!isAuthenticated ? <LoginPrompt /> : <Outlet />}</div>
								) : (
									<div className="h-full">
										<div
																								className={cn(
														'p-4 bg-layer-elevated lg:pt-8 lg:px-8 lg:pb-6 lg:bg-transparent h-full',
												location.pathname === '/dashboard/sales/sales' && 'p-0 lg:p-0',
												location.pathname.startsWith('/dashboard/sales/messages') && 'p-0 lg:p-0',
												location.pathname === '/dashboard/sales/circular-economy' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/products' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/collections' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/receiving-payments' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/products/shipping-options' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/profile' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/making-payments' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/your-purchases' && 'p-0 lg:p-0',
												location.pathname === '/dashboard/account/network' && 'p-0 lg:p-0',
											)}
										>
											{!isAuthenticated ? (
												<LoginPrompt />
											) : (
												<>
													{/* Only show title here if there's no back button */}
													{!isMobile &&
														!needsBackButton &&
												location.pathname !== '/dashboard/sales/sales' &&
												location.pathname !== '/dashboard/dashboard' &&
														!location.pathname.startsWith('/dashboard/sales/messages') &&
														location.pathname !== '/dashboard/sales/circular-economy' &&
														location.pathname !== '/dashboard/products/products' &&
														location.pathname !== '/dashboard/products/collections' &&
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
					{!isMobile && location.pathname !== '/dashboard/dashboard' && (
						<div className="hidden min-[1470px]:block lg:min-w-0 lg:flex-1 lg:max-w-32 xl:max-w-48 2xl:max-w-64 lg:border lg:border-black lg:rounded bg-layer-elevated lg:max-h-full lg:overflow-hidden lg:shadow-md">
							<div className="p-4 lg:px-6 lg:py-4 flex items-center justify-center h-full">
								<span className="text-3xl">₿</span>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Dashboard Settings Modal */}
			<DashboardSettingsModal />
		</div>
	)
}
