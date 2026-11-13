import { useConfigQuery } from '@/queries/config'
import { useUserRole } from '@/queries/app-settings'
import { useExtensionCatalog, useExtensionDescriptors } from '@/queries/extensions'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import {
	ExtensionsEmptyState,
	ExtensionStoreButton,
	ExtensionTile,
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
	SettingsMobileHeader,
	SettingsPageHeader,
} from '@ui/index'
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { Puzzle } from 'lucide-react'
import { REMOTE_EXTENSION_PREFIX, remoteExtensionId } from '@sdk/core/extensions'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/extensions')({
	component: ExtensionsComponent,
})

const header = { icon: Puzzle, title: 'Extensions', description: 'Extensions added to this marketplace' }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function ExtensionsComponent() {
	useDashboardTitle('Extensions')
	const matchRoute = useMatchRoute()
	const onExtensionPage = matchRoute({ to: '/dashboard/app-settings/extensions/$extensionId', fuzzy: true })
	const { data: config } = useConfigQuery()
	const { amIAdmin, currentUserPubkey, isLoading: isRoleLoading } = useUserRole(config?.appPublicKey)
	const { descriptors, isLoading } = useExtensionDescriptors()
	// The catalog lists added external extensions, including ones without bindings yet.
	const catalog = useExtensionCatalog(currentUserPubkey, amIAdmin && !onExtensionPage)

	if (onExtensionPage) return <Outlet />
	if (isLoading || isRoleLoading) return <SettingsLoadingSkeleton />
	// Client-side workflow gate only; every extension endpoint enforces its own auth and roles.
	if (!amIAdmin) return <SettingsAccessDenied header={header} message="Only marketplace admins can view extensions." />

	const builtins = descriptors.filter((descriptor) => !descriptor.id.startsWith(REMOTE_EXTENSION_PREFIX))
	const bindings = catalog.data?.bindings ?? []
	const external = (catalog.data?.repository?.entries ?? []).filter((entry) => entry.added)

	const storeButton = (
		<ExtensionStoreButton>
			<Link to="/dashboard/app-settings/extension-store" />
		</ExtensionStoreButton>
	)

	return (
		<div>
			<SettingsPageHeader {...header} actions={storeButton} />
			<div className="space-y-4 p-4 lg:p-8">
				<SettingsMobileHeader {...header} actions={storeButton} />

				{builtins.length === 0 && external.length === 0 && !catalog.isFetching ? (
					<ExtensionsEmptyState />
				) : (
					<div className="grid gap-3 md:grid-cols-2" data-testid="extension-list">
						{builtins.map((descriptor) => (
							<ExtensionTile
								key={descriptor.id}
								name={descriptor.displayName}
								icon={descriptor.icon}
								kind="built-in"
								description={descriptor.description}
								subtitle={plural(descriptor.actions.length, 'action')}
								testId={`extension-tile-${descriptor.id}`}
								link={<Link to="/dashboard/app-settings/extensions/$extensionId" params={{ extensionId: descriptor.id }} />}
							/>
						))}
						{external.map((entry) => {
							const own = bindings.filter((binding) => binding.serverPubkey === entry.serverPubkey)
							const needsReview = own.some((binding) => binding.state === 'misconfigured' || binding.state === 'unreachable')
							const id = remoteExtensionId(entry.serverPubkey)
							return (
								<ExtensionTile
									key={id}
									name={entry.name}
									icon={entry.picture}
									kind="external"
									description={entry.about}
									subtitle={own.length === 0 ? 'No actions yet' : plural(own.length, 'action')}
									warning={entry.state === 'unavailable' ? 'Unavailable' : needsReview ? 'Needs review' : undefined}
									testId={`extension-tile-${id}`}
									link={<Link to="/dashboard/app-settings/extensions/$extensionId" params={{ extensionId: id }} />}
								/>
							)
						})}
					</div>
				)}
				{catalog.isFetching && !catalog.data && <p className="text-sm text-muted-foreground">Loading external extensions…</p>}
			</div>
		</div>
	)
}
