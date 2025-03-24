import { DecryptPasswordDialog } from '@/components/auth/DecryptPasswordDialog'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { useConfigQuery } from '@/queries/config'
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
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

	// If loading or on setup page, render only the outlet without header/footer
	if (isLoading || isSetupPage) {
		return <Outlet />
	}

	return (
		<div className="flex flex-col min-h-screen">
			<Header
				appPicture={config?.appSettings?.picture}
				appDisplayName={config?.appSettings?.displayName}
				onLoginClick={() => setShowLoginDialog(true)}
			/>

			<main className="flex-grow">
				<div className="max-w-7xl mx-auto p-4">
					<Outlet />
				</div>
			</main>

			<Footer />

			{/* Having some build error with this rn */}
			{/* <TanStackRouterDevtools /> */}
			<DecryptPasswordDialog />
			<LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
		</div>
	)
}
