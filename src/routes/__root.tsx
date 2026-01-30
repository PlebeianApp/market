import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { Pattern } from '@/components/pattern'
import { SheetRegistry } from '@/components/SheetRegistry'
import { DialogRegistry } from '@/components/DialogRegistry'
import { configStore } from '@/lib/stores/config'
import { useAmIAdmin } from '@/queries/app-settings'
import { createRootRoute, Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { DecryptPasswordDialog } from '@/components/auth/DecryptPasswordDialog'
import { Toaster } from 'sonner'
import { useBlacklistSync } from '@/hooks/useBlacklistSync'
import { useVanitySync } from '@/hooks/useVanitySync'
import { useStore } from '@tanstack/react-store'

export const Route = createRootRoute({
	component: RootComponent,
})

function RootComponent() {
	return <RootLayout />
}

function RootLayout() {
	// Use configStore directly - config is already loaded by frontend.tsx before router renders
	const config = useStore(configStore, (s) => s.config)
	const navigate = useNavigate()
	const { pathname } = window.location
	const { amIAdmin, isLoading: isLoadingAdmin } = useAmIAdmin(config?.appPublicKey)
	const location = useLocation()
	const isAdminRoute = pathname.startsWith('/dashboard/app-settings')
	const isSetupPage = location.pathname === '/setup'
	const isDashboardPage = location.pathname.startsWith('/dashboard')
	const isCheckoutPage = location.pathname.startsWith('/checkout')

	// Sync blacklist store with backend data
	useBlacklistSync()

	// Sync vanity store with backend data
	useVanitySync()

	useEffect(() => {
		if (config?.needsSetup && !isSetupPage) {
			navigate({ to: '/setup' })
		} else if (!config?.needsSetup && isSetupPage) {
			navigate({ to: '/' })
		}
	}, [config, navigate, isSetupPage])

	// Protect admin routes
	useEffect(() => {
		if (isLoadingAdmin) return
		if (isAdminRoute && !amIAdmin) {
			// Redirect non-admins away from admin routes
			navigate({ to: '/dashboard' })
		}
	}, [isAdminRoute, amIAdmin, isLoadingAdmin, navigate])

	// If on setup page, render only the outlet without header/footer
	if (isSetupPage) {
		return <Outlet />
	}

	return (
		<div className="relative flex flex-col min-h-screen">
			<Header />

			<main className="flex-grow flex flex-col">
				<ErrorBoundary>
					<Outlet />
				</ErrorBoundary>
			</main>
			<Pattern pattern="page" />
			{!isDashboardPage && !isCheckoutPage && <Footer />}
			{/* Having some build error with this rn */}
			{/* <TanStackRouterDevtools /> */}
			<DecryptPasswordDialog />
			<SheetRegistry />
			<DialogRegistry />
			<Toaster />
		</div>
	)
}
