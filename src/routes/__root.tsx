import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { Pattern } from '@/components/pattern'
import { SheetRegistry } from '@/components/SheetRegistry'
import { DialogRegistry } from '@/components/DialogRegistry'
import { useConfigQuery } from '@/queries/config'
import { useAmIAdmin } from '@/queries/app-settings'
import { createRootRoute, Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { DecryptPasswordDialog } from '@/components/auth/DecryptPasswordDialog'
import { Toaster } from 'sonner'

export const Route = createRootRoute({
	component: RootComponent,
})

function RootComponent() {
	return <RootLayout />
}

function RootLayout() {
	const { data: config, isLoading, isError } = useConfigQuery()
	const navigate = useNavigate()
	const { pathname } = window.location
	const { amIAdmin, isLoading: isLoadingAdmin } = useAmIAdmin(config?.appPublicKey)
	const location = useLocation()
  const isAdminRoute = pathname.startsWith('/dashboard/app-settings')
	const isSetupPage = location.pathname === '/setup'
	const isDashboardPage = location.pathname.startsWith('/dashboard')
	const isProfilePage = location.pathname.startsWith('/profile/')

	useEffect(() => {
		if (isLoading || isError) return
		if (config?.needsSetup && !isSetupPage) {
			navigate({ to: '/setup' })
		} else if (!config?.needsSetup && isSetupPage) {
			navigate({ to: '/' })
		}
	}, [config, navigate, isLoading, isError, isSetupPage])

	// Protect admin routes
	useEffect(() => {
		if (isLoadingAdmin || isLoading || isError) return
		if (isAdminRoute && !amIAdmin) {
			// Redirect non-admins away from admin routes
			navigate({ to: '/dashboard' })
		}
	}, [isAdminRoute, amIAdmin, isLoadingAdmin, isLoading, isError, navigate])

	// If loading, don't render routes
	if (isLoading) {
		return <div className="flex justify-center items-center h-screen">Loading...</div>
	}

	// If on setup page, render only the outlet without header/footer
	if (isSetupPage) {
		return <Outlet />
	}

	return (
		<div className="flex flex-col min-h-screen">
			{!isProfilePage && <Header />}

			<main className="flex-grow flex flex-col">
				<Outlet />
			</main>
			<Pattern pattern="page" />
			{!isDashboardPage && <Footer />}
			{/* Having some build error with this rn */}
			{/* <TanStackRouterDevtools /> */}
			<DecryptPasswordDialog />
			<SheetRegistry />
			<DialogRegistry />
			<Toaster />
		</div>
	)
}
