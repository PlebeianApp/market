import { Link } from '@tanstack/react-router'
import { useConfigQuery } from '@/queries/config'
import { Button } from '@/components/ui/button'
import { ProductSearch } from '@/components/product-search'

export function Header() {
	const { data: config } = useConfigQuery()

	return (
		<header className="sticky top-0 z-30 bg-black py-4 text-white px-4">
			<div className="container flex h-full max-w-full items-center justify-between">
				<section className="inline-flex items-center">
					<Link to="/">
						<div className="flex items-center">
							{config?.appSettings?.picture && (
								<img src={config.appSettings.picture} alt={config.appSettings.displayName} className="w-16 px-2" />
							)}
							<span className="hidden lg:block lg:text-2xl">{config?.appSettings?.displayName || 'Market'}</span>
						</div>
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
					<Button 
						variant="primary" 
						className="p-2 relative rounded-md hover:[&>span]:text-secondary"
						icon={<span className="i-basket w-6 h-6" />}
					/>
					<Button 
						variant="primary" 
						className="p-2 relative rounded-md hover:[&>span]:text-secondary"
						icon={<span className="i-account w-6 h-6" />}
					/>
					</div>
				</div>
			</div>
			<div className="lg:hidden flex-1 pt-4">
				<ProductSearch />
			</div>
		</header>
	)
}
