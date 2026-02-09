import { BugReportButton } from '@/components/BugReportButton'
import { CartButton } from '@/components/CartButton'
import { CurrencyDropdown } from '@/components/CurrencyDropdown'
import { MobileMenu } from '@/components/layout/MobileMenu'
import { ProductSearch } from '@/components/ProductSearch'
import { Profile } from '@/components/Profile'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Nip60Wallet } from '@/feature/wallet/components/Nip60Wallet'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { authActions, authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationStore } from '@/lib/stores/notifications'
import { uiActions, uiStore } from '@/lib/stores/ui'
import { useConfigQuery } from '@/queries/config'
import type { NDKUserProfile } from '@nostr-dev-kit/ndk'
import { Link, useLocation } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Loader2, LogOut, Menu, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export function Header() {
	const { data: config } = useConfigQuery()
	const { isAuthenticated, isAuthenticating, user } = useStore(authStore)
	const { mobileMenuOpen } = useStore(uiStore)
	const { unseenOrders, unseenMessages, unseenPurchases } = useStore(notificationStore)
	const location = useLocation()
	const [scrollY, setScrollY] = useState(0)
	const [profile, setProfile] = useState<NDKUserProfile | null>(null)
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md'

	// Calculate total notification count for dashboard button
	const totalNotifications = unseenOrders + unseenMessages + unseenPurchases

	// Check if we're on any product page (index page or individual product) or homepage
	const isProductPage = location.pathname === '/products' || location.pathname.startsWith('/products/')
	const isProfilePage = location.pathname.startsWith('/profile/')
	const isHomepage = location.pathname === '/'
	const isCommunityPage = location.pathname === '/community'
	const isCollectionPage = location.pathname.startsWith('/collection/')
	const isNostrPage = location.pathname === '/nostr'
	const shouldUseTransparentHeader = isProductPage || isHomepage || isProfilePage || isCommunityPage || isCollectionPage

	// Scroll detection for pages with transparent headers
	useEffect(() => {
		if (!shouldUseTransparentHeader) return

		const handleScroll = () => {
			setScrollY(window.scrollY)
		}

		// Set initial scroll position
		setScrollY(window.scrollY)

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => window.removeEventListener('scroll', handleScroll)
	}, [shouldUseTransparentHeader])

	// Calculate background opacity based on scroll position
	const getHeaderBackground = () => {
		// Force black background when mobile menu is open
		if (mobileMenuOpen) return 'bg-black'

		// Force black background for nostr page only
		if (isNostrPage) return 'bg-black'

		if (!shouldUseTransparentHeader) return 'bg-black'

		// Always use transition class for pages with transparent headers
		return 'bg-header-scroll-transition'
	}

	// Calculate CSS variable for transitional background
	const getHeaderStyle = () => {
		// No transition styles needed when mobile menu is open (solid black)
		if (mobileMenuOpen) return {}

		// No transition styles needed for nostr page only
		if (isNostrPage) return {}

		if (!shouldUseTransparentHeader) return {}

		if (scrollY < 80) {
			return {
				'--header-bg-opacity': 'linear-gradient(to bottom, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0.5) 50%, rgba(0, 0, 0, 0) 100%)',
				background: 'var(--header-bg-opacity)',
			}
		} else if (scrollY < 160) {
			const progress = (scrollY - 80) / 80
			// Transition from gradient to solid black
			return {
				'--header-bg-opacity': `rgba(0, 0, 0, ${progress})`,
				background: 'var(--header-bg-opacity)',
			}
		} else {
			return {
				'--header-bg-opacity': 'rgba(0, 0, 0, 1.0)',
				background: 'var(--header-bg-opacity)',
			}
		}
	}

	// Fetch user profile when authenticated
	useEffect(() => {
		if (!user?.pubkey || !isAuthenticated) {
			setProfile(null)
			return
		}

		const fetchProfile = async () => {
			try {
				const ndk = ndkActions.getNDK()
				if (!ndk) return

				const ndkUser = ndk.getUser({ pubkey: user.pubkey })
				const userProfile = await ndkUser.fetchProfile()
				setProfile(userProfile)
			} catch (error) {
				console.error('Error fetching profile:', error)
			}
		}

		fetchProfile()
	}, [user?.pubkey, isAuthenticated])

	function handleLoginClick() {
		uiActions.openDialog('login')
	}

	function handleMobileMenuClick() {
		uiActions.toggleMobileMenu()
	}

	return (
		<header
			className={`sticky top-0 z-50 text-white px-4 ${isNostrPage ? 'bg-black' : getHeaderBackground()}`}
			style={isNostrPage ? {} : (getHeaderStyle() as React.CSSProperties)}
		>
			<div className="container flex h-full max-w-full items-center justify-between py-4">
				<section className="inline-flex items-center">
					<Link to="/" data-testid="home-link">
						{config?.appSettings?.picture && (
							<img src={config.appSettings.picture} alt={config.appSettings.displayName} className="w-16 px-2" />
						)}
					</Link>
					<div className="hidden sm:flex mx-8 gap-8">
						<Link
							to="/products"
							className="hover:text-secondary"
							activeProps={{
								className: 'text-secondary',
							}}
						>
							Products
						</Link>
						<Link
							to="/community"
							className="hover:text-secondary"
							activeProps={{
								className: 'text-secondary',
							}}
						>
							Community
						</Link>
						{config?.appSettings?.showNostrLink && (
							<Link
								to="/nostr"
								className="hover:text-secondary"
								activeProps={{
									className: 'text-secondary',
								}}
							>
								Nostr
							</Link>
						)}
					</div>
				</section>
				<div className="flex items-center gap-2 lg:gap-4">
					<div className="hidden lg:block flex-1">
						<ProductSearch />
					</div>
					<div className="flex gap-2">
						{/* Bug Report Button - visible when authenticated on desktop */}
						{!isMobile && (
							<BugReportButton className="!static !w-auto !rounded-lg !shadow-none !bg-primary-border !border-2 !border-transparent hover:!bg-black hover:!border-primary-border-hover p-2 relative hover:[&>span]:text-secondary" />
						)}
						{/* Currency Dropdown - always visible on desktop */}
						{!isMobile && <CurrencyDropdown />}

						{/* Mobile Layout */}
						{isMobile ? (
							<>
								{/* Bug Report Button - visible when authenticated on mobile */}
								<BugReportButton className="!static !w-auto !rounded-lg !shadow-none !bg-primary-border !border-2 !border-transparent hover:!bg-black hover:!border-primary-border-hover p-2 relative hover:[&>span]:text-secondary" />
								{/* Account Button/Avatar - changes based on auth state - positioned first when logged in */}
								{isAuthenticating ? (
									<Button variant="primary" className="p-2 relative" data-testid="auth-loading">
										<Loader2 className="h-4 w-4 animate-spin" />
									</Button>
								) : isAuthenticated ? (
									<Profile compact />
								) : (
									<Button
										variant="primary"
										className="p-2 relative hover:[&>span]:text-secondary"
										icon={<span className="i-account w-6 h-6" />}
										onClick={handleLoginClick}
										data-testid="login-button"
									/>
								)}

								{/* Cart Button - always visible on mobile */}
								<CartButton />

								{/* Menu Button - always visible on mobile */}
								<Button
									variant="primary"
									className="p-2 relative hover:bg-secondary/20"
									onClick={handleMobileMenuClick}
									data-testid="mobile-menu-button"
								>
									<span className="sr-only">{mobileMenuOpen ? 'Close menu' : 'Open menu'}</span>
									<Menu
										className={`transition-transform duration-300 ease-in-out ${mobileMenuOpen ? 'rotate-90 scale-0' : 'rotate-0 scale-100'}`}
									/>
									<X
										className={`absolute transition-transform duration-300 ease-in-out ${mobileMenuOpen ? 'rotate-0 scale-100' : '-rotate-90 scale-0'}`}
									/>
								</Button>
							</>
						) : (
							/* Desktop Layout - unchanged */
							<>
								{isAuthenticating ? (
									<Button variant="primary" className="p-2 relative" data-testid="auth-loading">
										<Loader2 className="h-4 w-4 animate-spin" />
									</Button>
								) : isAuthenticated ? (
									<>
										<CartButton />
										<Tooltip>
											<TooltipTrigger asChild>
												<Link to="/dashboard" data-testid="dashboard-link" className="relative">
													<Button
														variant="primary"
														className={`p-2 relative hover:[&>span]:text-secondary ${
															location.pathname.startsWith('/dashboard') ? 'bg-secondary text-black [&>span]:text-black' : ''
														}`}
														icon={<span className="i-dashboard w-6 h-6" />}
														data-testid="dashboard-button"
													/>
													{totalNotifications > 0 && (
														<span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[10px] font-bold text-white bg-pink-500 rounded-full">
															{totalNotifications > 99 ? '99+' : totalNotifications}
														</span>
													)}
												</Link>
											</TooltipTrigger>
											<TooltipContent side="bottom">Dashboard</TooltipContent>
										</Tooltip>
										<Popover>
											<Tooltip>
												<TooltipTrigger asChild>
													<PopoverTrigger asChild>
														<Button variant="primary" className="p-2 relative hover:[&>svg]:text-secondary" data-testid="wallet-button">
															<Wallet className="w-6 h-6" />
														</Button>
													</PopoverTrigger>
												</TooltipTrigger>
												<TooltipContent side="bottom">Wallet</TooltipContent>
											</Tooltip>
											<PopoverContent className="md:w-96 w-[calc(100vw-2rem)] bg-primary rounded-lg" align="end">
												<Nip60Wallet />
											</PopoverContent>
										</Popover>
										<Profile compact />
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="primary"
													className="p-2 relative hover:[&>svg]:text-secondary"
													onClick={() => authActions.logout()}
													data-testid="logout-button"
												>
													<LogOut className="w-6 h-6" />
												</Button>
											</TooltipTrigger>
											<TooltipContent side="bottom">Logout</TooltipContent>
										</Tooltip>
									</>
								) : (
									<Button
										variant="primary"
										className="p-2 relative hover:[&>span]:text-secondary"
										icon={<span className="i-account w-6 h-6" />}
										onClick={handleLoginClick}
										data-testid="login-button"
									/>
								)}
							</>
						)}
					</div>
				</div>
			</div>
			<div className="lg:hidden flex-1 pb-4">
				<ProductSearch />
			</div>

			{/* Mobile Menu */}
			<MobileMenu />
		</header>
	)
}
