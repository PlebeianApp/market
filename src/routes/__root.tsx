import { DecryptPasswordDialog } from '@/components/auth/DecryptPasswordDialog'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { Pattern } from '@/components/pattern'
import { defaulRelaysUrls } from '@/lib/constants'
import { authActions } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
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
	const [ndkInitialized, setNdkInitialized] = useState(false)
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

	useEffect(() => {
		const initializeNDK = async () => {
			if (config?.appRelay) {
				console.log(`Adding relay from config: ${config.appRelay}`)
				ndkActions.initialize([config.appRelay, ...defaulRelaysUrls])
				await ndkActions.connect()
				await authActions.getAuthFromLocalStorageAndLogin()
				console.log('NDK initialized')
				setNdkInitialized(true)
			}
		}

		if (config && !ndkInitialized) {
			initializeNDK().catch(console.error)
		}
	}, [config, ndkInitialized])

	// If loading or NDK not yet initialized, don't render routes
	if (isLoading || (config?.appRelay && !ndkInitialized)) {
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

			<Footer />

			{/* Having some build error with this rn */}
			{/* <TanStackRouterDevtools /> */}
			<Pattern pattern="page" />

			<DecryptPasswordDialog />
			<LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
		</div>
	)
}
