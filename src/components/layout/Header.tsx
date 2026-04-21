import { CurrencyDropdown } from '@/components/CurrencyDropdown'
import { MobileMenu } from '@/components/layout/MobileMenu'
import { ProductSearch } from '@/components/ProductSearch'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Nip60Wallet } from '@/feature/wallet/components/Nip60Wallet'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { authActions, authStore } from '@/lib/stores/auth'
import { notificationStore } from '@/lib/stores/notifications'
import { uiActions, uiStore } from '@/lib/stores/ui'
import { useConfigQuery } from '@/queries/config'
import { Link, useNavigate, useLocation } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Loader2, LogOut, Menu, Wallet, X } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import { cartStore } from '@/lib/stores/cart'
import { AvatarUser } from '@/components/AvatarUser'
import { cn } from '@/lib/utils'
import { useProfile } from '@/queries/profiles'
import { BugReportModal } from '../BugReportModal'
import { TooltipButton } from '../shared/TooltipButton'

const LoginButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => {
	return (
		<TooltipButton
			className="relative p-2 btn-border-highlight hover:[&>span]:text-secondary"
			data-testid="login-button"
			ref={ref}
			tooltip="Log In"
			{...props}
			onClick={() => uiActions.openDialog('login')}
		>
			<span className="w-6 h-6 i-account" />
		</TooltipButton>
	)
})

const LogoutButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => {
	return (
		<TooltipButton
			className="relative p-2 btn-border-highlight hover:[&>svg]:text-secondary"
			data-testid="logout-button"
			ref={ref}
			tooltip="Log Out"
			{...props}
			onClick={() => authActions.logout()}
		>
			<LogOut className="size-4" />
		</TooltipButton>
	)
})

const ProfileButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => {
	const authState = useStore(authStore)
	const navigate = useNavigate()
	const location = useLocation()

	const { data, isPending, fetchStatus } = useProfile(authState.user?.pubkey)

	// Check if we're on the user's own profile page
	const isOnOwnProfile = authState.user?.pubkey && location.pathname === `/profile/${authState.user.pubkey}`

	const handleProfileClick = () => {
		if (authState.isAuthenticated && authState.user?.pubkey) {
			navigate({ to: '/profile/$profileId', params: { profileId: authState.user.pubkey } })
		}
	}

	// Note: Loading Spinner, Unauthenticated etc. handled in parent.
	// If not authenticated, return empty.
	if ((isPending && fetchStatus === 'fetching') || !authState.isAuthenticated) {
		return <></>
	}

	// Both desktop and mobile - simple button that navigates to profile when authenticated
	return (
		<TooltipButton
			className={cn('relative p-2 btn-border-highlight', isOnOwnProfile && 'btn-active')}
			ref={ref}
			tooltip="Go to profile"
			{...props}
			onClick={handleProfileClick}
		>
			<AvatarUser pubkey={authState.user?.pubkey} className="mx-1 w-6 h-6" />
		</TooltipButton>
	)
})

const CartButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => {
	const { cart } = useStore(cartStore)

	const totalItems = Object.values(cart.products).reduce((total, product) => {
		return total + product.amount
	}, 0)

	const handleClick = () => {
		uiActions.openDrawer('cart')
	}

	return (
		<TooltipButton
			tooltip="View cart"
			className="relative p-2 btn-border-highlight hover:text-secondary"
			ref={ref}
			{...props}
			onClick={handleClick}
		>
			<span className="w-6 h-6 i-basket" />
			{totalItems > 0 && (
				<span className="-top-2.5 -right-2.5 absolute flex justify-center items-center bg-secondary rounded-full w-5 h-5 font-bold text-black text-xs">
					{totalItems > 99 ? '99+' : totalItems}
				</span>
			)}
		</TooltipButton>
	)
})

interface DashboardButtonProps {
	totalNotifications?: number
}

const DashboardButton = forwardRef<HTMLButtonElement, DashboardButtonProps>((props, ref) => {
	const totalNotifications = props.totalNotifications ?? 0

	return (
		<Link to="/dashboard" data-testid="dashboard-link" className="relative">
			<TooltipButton
				className={`btn-border-highlight p-2 relative hover:[&>span]:text-secondary ${
					location.pathname.startsWith('/dashboard') ? 'btn-active' : ''
				}`}
				data-testid="dashboard-button"
				tooltip="Dashboard"
				ref={ref}
				{...props}
			>
				<span className="w-6 h-6 i-dashboard" />
			</TooltipButton>
			{totalNotifications > 0 && (
				<span className="-top-2 -right-2 absolute flex justify-center items-center bg-secondary rounded-full w-5 h-5 font-bold text-black text-xs">
					{totalNotifications > 99 ? '99+' : totalNotifications}
				</span>
			)}
		</Link>
	)
})

function WalletButton() {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<TooltipButton
					tooltip="Wallet"
					className="relative p-2 btn-border-highlight hover:[&>svg]:text-secondary"
					data-testid="wallet-button"
				>
					<Wallet className="size-4" />
				</TooltipButton>
			</PopoverTrigger>

			<PopoverContent className="bg-primary rounded-lg w-[calc(100vw-2rem)] md:w-96" align="end">
				<Nip60Wallet />
			</PopoverContent>
		</Popover>
	)
}

interface BugReportButtonProps {
	className?: string
}

export function BugReportButton({ className }: BugReportButtonProps) {
	const [isModalOpen, setIsModalOpen] = useState(false)

	const handleBugReport = () => {
		setIsModalOpen(true)
	}

	return (
		<>
			<TooltipButton
				variant="outline"
				size="icon"
				onClick={handleBugReport}
				tooltip="Report a bug"
				className={cn(
					'right-16 bottom-16 z-50 fixed bg-black hover:bg-black shadow-lg px-4 py-2 rounded-full w-10 h-10 text-white hover:text-secondary transition-colors',
					className,
				)}
				aria-label="Report a bug"
			>
				<span className="hover:bg-black px-2 py-0 w-6 h-6 hover:text-secondary i-bug" />
			</TooltipButton>
			<BugReportModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onReopen={() => setIsModalOpen(true)} />
		</>
	)
}

export function Header() {
	const { data: config } = useConfigQuery()
	const { isAuthenticated, isAuthenticating, user } = useStore(authStore)
	const { mobileMenuOpen } = useStore(uiStore)
	const { unseenOrders, unseenMessages, unseenPurchases } = useStore(notificationStore)
	const location = useLocation()
	const [scrollY, setScrollY] = useState(0)
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

	function handleMobileMenuClick() {
		uiActions.toggleMobileMenu()
	}

	return (
		<header
			className={`sticky top-0 z-50 text-white px-4 ${isNostrPage ? 'bg-black' : getHeaderBackground()}`}
			style={isNostrPage ? {} : (getHeaderStyle() as React.CSSProperties)}
		>
			<div className="flex justify-between items-center py-4 max-w-full h-full container">
				<section className="inline-flex items-center">
					<Link to="/" data-testid="home-link">
						{config?.appSettings?.picture && (
							<img src={config.appSettings.picture} alt={config.appSettings.displayName} className="px-2 w-16" />
						)}
					</Link>
					<div className="hidden sm:flex gap-8 mx-8">
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
						{/* Bug Report Button - Only when authenticated */}
						{isAuthenticated && (
							<BugReportButton className="!static relative hover:!bg-black !shadow-none p-2 !bg-primary-border !border-2 !border-transparent hover:!border-primary-border-hover !rounded-lg !w-auto hover:[&>span]:text-secondary" />
						)}

						{/* Currency Selector - Desktop Only */}
						{!isMobile && <CurrencyDropdown />}

						{/* Cart Button */}
						<CartButton />

						{/* Dashboard Button - Desktop & authenticated only */}
						{isAuthenticated && !isMobile && <DashboardButton totalNotifications={totalNotifications} />}

						{/* Wallet Button - Desktop & authenticated only */}
						{isAuthenticated && !isMobile && <WalletButton />}

						{/* Profile Button/Avatar, or Log-In Button if not authenticated */}
						{isAuthenticating ? (
							<Button className="relative p-2 btn-border-highlight" data-testid="auth-loading">
								<Loader2 className="w-4 h-4 animate-spin" />
							</Button>
						) : isAuthenticated ? (
							<ProfileButton />
						) : (
							<LoginButton />
						)}

						{/* Log-Out Button, only display on Desktop & when authenticated */}
						{isAuthenticated && !isMobile && <LogoutButton />}

						{/* Mobile Drop-down Menu */}
						{isMobile && (
							<Button
								className="relative hover:bg-secondary/20 p-2 btn-border-highlight"
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
