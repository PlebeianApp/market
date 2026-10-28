import { StorefrontOrProfilePage } from '@/components/pages/StorefrontOrProfilePage'
import { useStandalonePage } from '@/hooks/useStandalonePage'
import { vanityActions, vanityStore } from '@/lib/stores/vanity'
import { useStore } from '@tanstack/react-store'

export function VanityStorefrontPage({ name, subdomain = false }: { name: string; subdomain?: boolean }) {
	const { isLoaded, entries } = useStore(vanityStore)
	const entry = entries.get(name.toLowerCase())
	const active = entry && entry.validUntil > Date.now() / 1000 && !vanityActions.isReservedName(name)
	useStandalonePage(subdomain)

	if (!isLoaded)
		return (
			<p className="p-12 text-center" role="status">
				Loading storefront…
			</p>
		)

	if (active) return <StorefrontOrProfilePage profileId={entry.pubkey} />

	return (
		<div className="mx-auto max-w-lg p-12 text-center">
			<h1 className="text-3xl font-bold">Storefront unavailable</h1>
			<p className="mt-4">The name {name} is not registered or has expired.</p>
		</div>
	)
}
