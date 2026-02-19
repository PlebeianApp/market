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

const LoginButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => {
	return (
		<Button
			variant="primary"
			className="p-2 relative hover:[&>span]:text-secondary"
			icon={<span className="i-account w-6 h-6" />}
			data-testid="login-button"
			ref={ref}
			tooltip="Log In"
			{...props}
			onClick={() => uiActions.openDialog('login')}
		/>
	)
})

const LogoutButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => {
	return (
		<Button
			variant="primary"
			className="p-2 relative hover:[&>svg]:text-secondary"
			data-testid="logout-button"
			ref={ref}
			tooltip="Log Out"
			{...props}
			onClick={() => authActions.logout()}
		>
			<LogOut className="w-6 h-6" />
		</Button>
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

	// Only show spinner while actively fetching for the first time
	if (isPending && fetchStatus === 'fetching') {
		return (
			<Button variant="ghost" size={'icon'} disabled>
				<Loader2 className={cn('h-4 w-4 animate-spin')} />
			</Button>
		)
	}

	// Both desktop and mobile - simple button that navigates to profile when authenticated
	return (
		<Button
			variant={authState.isAuthenticated ? 'primary' : 'outline'}
			size={'icon'}
			className={cn(
				'p-2 w-full relative',
				!authState.isAuthenticated && 'text-muted-foreground hover:text-foreground',
				isOnOwnProfile && 'bg-secondary text-black hover:bg-secondary hover:text-black',
			)}
			ref={ref}
			tooltip="Go to profile"
			{...props}
			onClick={handleProfileClick}
		>
			{authState.isAuthenticated ? (
				<AvatarUser pubkey={authState.user?.pubkey} className="w-6 h-6" />
			) : (
				<>
					{authState.isAuthenticated ? (
						<span className={cn('i-account w-6 h-6', isOnOwnProfile && 'text-black')} />
					) : (
						<span className="i-account w-6 h-6" />
					)}
				</>
			)}
		</Button>
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
		<Button variant="primary" tooltip="View cart" className="p-2 relative hover:text-secondary" ref={ref} {...props} onClick={handleClick}>
			<span className="i-basket w-6 h-6" />
			{totalItems > 0 && (
				<span className="absolute -top-2.5 -right-2.5 bg-secondary text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
					{totalItems > 99 ? '99+' : totalItems}
				</span>
			)}
		</Button>
	)
})

interface DashboardButtonProps {
	totalNotifications?: number
}

const DashboardButton = forwardRef<HTMLButtonElement, DashboardButtonProps>((props, ref) => {
	const totalNotifications = props.totalNotifications ?? 0

	return (
		<Link to="/dashboard" data-testid="dashboard-link" className="relative">
			<Button
				variant="primary"
				className={`p-2 relative hover:[&>span]:text-secondary ${
					location.pathname.startsWith('/dashboard') ? 'bg-secondary text-black [&>span]:text-black' : ''
				}`}
				icon={<span className="i-dashboard w-6 h-6" />}
				data-testid="dashboard-button"
				tooltip="Dashboard"
				ref={ref}
				{...props}
			/>
			{totalNotifications > 0 && (
				<span className="absolute -top-2 -right-2 bg-secondary text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
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
				<Button variant="primary" tooltip="Wallet" className="p-2 relative hover:[&>svg]:text-secondary" data-testid="wallet-button">
					<Wallet className="w-6 h-6" />
				</Button>
			</PopoverTrigger>

			<PopoverContent className="md:w-96 w-[calc(100vw-2rem)] bg-primary rounded-lg" align="end">
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
			<Button
				variant="outline"
				size="icon"
				onClick={handleBugReport}
				tooltip="Report a bug"
				className={cn(
					'fixed bottom-16 right-16 z-50 h-10 w-10 px-4 py-2 rounded-full bg-black text-white hover:bg-black hover:text-secondary shadow-lg transition-colors',
					className,
				)}
				aria-label="Report a bug"
			>
				<span className="i-bug w-6 h-6 px-2 py-0 hover:bg-black hover:text-secondary" />
			</Button>
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
	const isAuctionPage = location.pathname === '/auctions' || location.pathname.startsWith('/auctions/')
	const isProfilePage = location.pathname.startsWith('/profile/')
	const isHomepage = location.pathname === '/'
	const isCommunityPage = location.pathname === '/community'
	const isCollectionPage = location.pathname.startsWith('/collection/')
	const isNostrPage = location.pathname === '/nostr'
	const shouldUseTransparentHeader = isProductPage || isAuctionPage || isHomepage || isProfilePage || isCommunityPage || isCollectionPage

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
							to="/auctions"
							className="hover:text-secondary"
							activeProps={{
								className: 'text-secondary',
							}}
						>
							Auctions
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
							<BugReportButton className="!static !w-auto !rounded-lg !shadow-none !bg-primary-border !border-2 !border-transparent hover:!bg-black hover:!border-primary-border-hover p-2 relative hover:[&>span]:text-secondary" />
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
							<Button variant="primary" className="p-2 relative" data-testid="auth-loading">
								<Loader2 className="h-4 w-4 animate-spin" />
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
