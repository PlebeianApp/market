import React, { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { uiStore, uiActions } from '@/lib/stores/ui'
import { authActions, authStore } from '@/lib/stores/auth'
import { cn } from '@/lib/utils'

export function MobileMenu() {
	const { mobileMenuOpen } = useStore(uiStore)
	const { isAuthenticated } = useStore(authStore)

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

	if (!mobileMenuOpen) return null

	const menuItems = [
		{ to: '/', label: 'Home' },
		{ to: '/products', label: 'Products' },
		{ to: '/community', label: 'Community' },
		{ to: '/nostr', label: 'Nostr' },
		...(isAuthenticated ? [{ to: '/dashboard', label: 'Dashboard' }] : []),
	]

	return (
		<div 
			className={cn(
				'fixed inset-0 z-50 bg-black transition-opacity duration-300',
				mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
			)}
			onClick={() => uiActions.closeMobileMenu()}
		>
			{/* Menu Content */}
			<div 
				className="flex flex-col items-center justify-center h-full"
				onClick={(e) => e.stopPropagation()}
			>
				<nav className="flex flex-col items-center gap-8">
					{menuItems.map((item) => (
						<Link
							key={item.to}
							to={item.to}
							className="text-white text-2xl font-bold hover:text-secondary transition-colors"
							onClick={handleLinkClick}
						>
							{item.label}
						</Link>
					))}
					{isAuthenticated && (
						<button
							onClick={handleLogout}
							className="text-white text-2xl font-bold hover:text-secondary transition-colors"
						>
							Log out
						</button>
					)}
				</nav>
			</div>
		</div>
	)
} 