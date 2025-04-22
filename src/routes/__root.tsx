import { DecryptPasswordDialog } from '@/components/auth/DecryptPasswordDialog'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { Pattern } from '@/components/pattern'
import { SheetRegistry } from '@/components/SheetRegistry'
import { useConfigQuery } from '@/queries/config'
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createRootRoute({
	component: RootComponent,
})

function RootComponent() {
	return <RootLayout />
}

function RootLayout() {
	const { data: config, isLoading, isError } = useConfigQuery()
	const [showLoginDialog, setShowLoginDialog] = useState(false)
	const navigate = useNavigate()
	const isSetupPage = window.location.pathname === '/setup'

	useEffect(() => {
		if (isLoading || isError) return
		if (config?.needsSetup && !isSetupPage) {
			navigate({ to: '/setup' })
		} else if (!config?.needsSetup && isSetupPage) {
			navigate({ to: '/' })
		}
	}, [config, navigate, isLoading, isError, isSetupPage])

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
			<Header onLoginClick={() => setShowLoginDialog(true)} />

			<main className="flex-grow">
				<Outlet />
			</main>
			<Pattern pattern="page" />
			<Footer />
			{/* Having some build error with this rn */}
			{/* <TanStackRouterDevtools /> */}
			<DecryptPasswordDialog />
			<SheetRegistry />
			<LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
		</div>
	)
}
