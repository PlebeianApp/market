import { CurrencyDropdown } from '@/components/CurrencyDropdown'
import { Pattern } from '@/components/pattern'
import { authActions, authStore } from '@/lib/stores/auth'
import { uiActions, uiStore } from '@/lib/stores/ui'
import { cn } from '@/lib/utils'
import { useConfigQuery } from '@/queries/config'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Link, useMatchRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

export function MobileMenu() {
	const { mobileMenuOpen } = useStore(uiStore)
	const { isAuthenticated } = useStore(authStore)
	const { data: config } = useConfigQuery()
	const matchRoute = useMatchRoute()
	const [animationParent] = useAutoAnimate<HTMLDivElement>()

	// Close menu on escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && mobileMenuOpen) {
				uiActions.closeMobileMenu()
			}
		}

		document.addEventListener('keydown', handleEscape)
		return () => document.removeEventListener('keydown', handleEscape)
	}, [mobileMenuOpen])

	// Prevent body scroll when menu is open
	useEffect(() => {
		if (mobileMenuOpen) {
			document.body.style.overflow = 'hidden'
		} else {
			document.body.style.overflow = 'unset'
		}

		return () => {
			document.body.style.overflow = 'unset'
		}
	}, [mobileMenuOpen])

	const handleLinkClick = () => {
		uiActions.closeMobileMenu()
	}

	const handleLogout = () => {
		authActions.logout()
		uiActions.closeMobileMenu()
	}

	const menuItems = [
		{ to: '/', label: 'Home' },
		{ to: '/products', label: 'Products' },
		{ to: '/community', label: 'Community' },
		...(config?.appSettings?.showNostrLink ? [{ to: '/nostr', label: 'Nostr' }] : []),
		...(isAuthenticated ? [{ to: '/dashboard', label: 'Dashboard' }] : []),
	]

	return (
		<div ref={animationParent}>
			{mobileMenuOpen && (
				<div className={cn('fixed top-16 left-0 right-0 bottom-0 z-40 bg-black/90')} onClick={() => uiActions.closeMobileMenu()}>
					{/* Dots Pattern Overlay */}
					<Pattern pattern="dots" className="opacity-30" />

					{/* Menu Content */}
					<div className="flex flex-col items-center justify-center h-full relative z-10" onClick={(e) => e.stopPropagation()}>
						<nav className="flex flex-col items-stretch gap-4 w-full max-w-sm">
							{menuItems.map((item) => {
								const isActive = matchRoute({ to: item.to, fuzzy: item.to !== '/' })
								return (
									<Link
										key={item.to}
										to={item.to}
										className={cn(
											'py-3 px-6 rounded-lg text-center text-lg font-normal uppercase tracking-wider transition-colors',
											isActive ? 'bg-black text-secondary' : 'text-white hover:text-secondary',
										)}
										onClick={handleLinkClick}
									>
										{item.label}
									</Link>
								)
							})}
							{isAuthenticated && (
								<div className="py-3 px-8">
									<button
										onClick={handleLogout}
										className="w-full text-center text-white text-lg font-normal uppercase tracking-wider hover:text-secondary transition-colors"
									>
										Log out
									</button>
								</div>
							)}

							{/* Currency Dropdown for mobile */}
							<div className="py-3 px-6 flex justify-center">
								<CurrencyDropdown />
							</div>
						</nav>
					</div>
				</div>
			)}
		</div>
	)
}
