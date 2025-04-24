import { ProductSearch } from '@/components/ProductSearch'
import { Profile } from '@/components/Profile'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { useConfigQuery } from '@/queries/config'
import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Loader2 } from 'lucide-react'
import { CartButton } from '@/components/CartButton'
import { uiActions } from '@/lib/stores/ui'

export function Header() {
	const { data: config } = useConfigQuery()
	const { isAuthenticated, isAuthenticating } = useStore(authStore)

	function handleLoginClick() {
		uiActions.openDialog('login')
	}

	return (
		<header className="sticky top-0 z-30 bg-black py-4 text-white px-4">
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
