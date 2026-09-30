import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { StorefrontBuilder } from '@/components/storefront/builder/StorefrontBuilder'
import { authStore } from '@/lib/stores/auth'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/profile-page')({
	component: ProfilePageBuilderRoute,
})

/**
 * Dashboard route for the page builder.
 *
 * The author's pubkey comes from the auth store rather than a route param:
 * there is exactly one page a signed-in user can edit — their own — and taking
 * it from the URL would invite an "edit somebody else's page" shape the signer
 * would then refuse anyway.
 *
 * `_dashboard-layout` already renders the login prompt for signed-out visitors,
 * so this component only handles the case where auth is present but the pubkey
 * has not arrived yet.
 */
function ProfilePageBuilderRoute() {
	useDashboardTitle('🎨 Profile Page')
	const user = useStore(authStore, (state) => state.user)
	const pubkey = user?.pubkey

	if (!pubkey) {
		return <p className="p-8 text-center text-muted-foreground">Loading your account…</p>
	}

	return <StorefrontBuilder pubkey={pubkey} />
}
