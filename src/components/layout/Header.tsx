import { ProductSearch } from '@/components/ProductSearch'
import { Profile } from '@/components/Profile'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { useConfigQuery } from '@/queries/config'
import { Link, useLocation } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Loader2 } from 'lucide-react'
import { CartButton } from '@/components/CartButton'
import { uiActions } from '@/lib/stores/ui'
import { useState, useEffect } from 'react'

export function Header() {
	const { data: config } = useConfigQuery()
	const { isAuthenticated, isAuthenticating } = useStore(authStore)
	const location = useLocation()
	const [scrollY, setScrollY] = useState(0)
	
	// Check if we're on a product page
	const isProductPage = location.pathname.startsWith('/products/') && location.pathname !== '/products'

	// Scroll detection for product pages
	useEffect(() => {
		if (!isProductPage) return

		const handleScroll = () => {
			setScrollY(window.scrollY)
		}

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => window.removeEventListener('scroll', handleScroll)
	}, [isProductPage])

	// Calculate background opacity based on scroll position
	const getHeaderBackground = () => {
		if (!isProductPage) return 'bg-black'
		
		if (scrollY < 80) {
			// 0-80px: transparent
			return 'bg-header-scroll-transition'
		} else if (scrollY < 160) {
			// 80-160px: transition from transparent to black
			const progress = (scrollY - 80) / 80
			const opacity = 0.3 + (0.7 * progress) // 0.3 to 1.0
			return 'bg-header-scroll-transition'
		} else {
			// 160px+: full black
			return 'bg-black'
		}
	}

	// Calculate CSS variable for transitional background
	const getHeaderStyle = () => {
		if (!isProductPage) return {}
		
		if (scrollY < 80) {
			return { '--header-bg-opacity': 'rgba(0, 0, 0, 0.3)' }
		} else if (scrollY < 160) {
			const progress = (scrollY - 80) / 80
			const opacity = 0.3 + (0.7 * progress)
			return { '--header-bg-opacity': `rgba(0, 0, 0, ${opacity})` }
		} else {
			return {}
		}
	}

	function handleLoginClick() {
		uiActions.openDialog('login')
	}

	return (
		<header 
			className={`sticky top-0 z-30 py-4 text-white px-4 ${getHeaderBackground()}`}
			style={getHeaderStyle() as React.CSSProperties}
		>
			<div className="container flex h-full max-w-full items-center justify-between">
				<section className="inline-flex items-center">
					<Link to="/">
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
						<Link
							to="/nostr"
							className="hover:text-secondary"
							activeProps={{
								className: 'text-secondary',
							}}
						>
							Nostr
						</Link>
					</div>
				</section>
				<div className="flex items-center gap-2 lg:gap-4">
					<div className="hidden lg:block flex-1">
						<ProductSearch />
					</div>
					<div className="flex gap-2">
						{isAuthenticating ? (
							<Button variant="primary" className="p-2 relative rounded-md">
								<Loader2 className="h-4 w-4 animate-spin" />
							</Button>
						) : isAuthenticated ? (
							<>
								<CartButton />
								<Link to="/dashboard">
									<Button
										variant="primary"
										className="p-2 relative rounded-md hover:[&>span]:text-secondary"
										icon={<span className="i-dashboard w-6 h-6" />}
									/>
								</Link>
								<Profile compact />
							</>
						) : (
							<Button
								variant="primary"
								className="p-2 relative rounded-md hover:[&>span]:text-secondary"
								icon={<span className="i-account w-6 h-6" />}
								onClick={handleLoginClick}
							/>
						)}
					</div>
				</div>
			</div>
			<div className="lg:hidden flex-1 pt-4">
				<ProductSearch />
			</div>
		</header>
	)
}
