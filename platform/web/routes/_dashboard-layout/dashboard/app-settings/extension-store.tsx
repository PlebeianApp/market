import { useConfigQuery } from '@/queries/config'
import { useUserRole } from '@/queries/app-settings'
import {
	extensionErrorMessage,
	useBindingMutations,
	useExtensionCatalog,
	useServerMutations,
	useBuiltinMutations,
} from '@/queries/extensions'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import { ExtensionStoreView, SettingsAccessDenied, SettingsLoadingSkeleton, SettingsMobileHeader, SettingsPageHeader } from '@ui/index'
import { Button } from '@ui/primitives/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Store } from 'lucide-react'
import { useMemo } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/extension-store')({
	component: ExtensionStoreComponent,
})

const header = {
	icon: Store,
	title: 'Extension store',
	description: 'Third-party and built-in extensions',
}
const REGISTRY_ENV_EXAMPLE =
	'EXTENSIONS_REGISTRY_CURATORS=npub1…\n# optional, defaults to the app relay\nEXTENSIONS_REGISTRY_RELAYS=wss://relay.example'

function ExtensionStoreComponent() {
	useDashboardTitle('Extension store')
	const { data: config } = useConfigQuery()
	const { amIAdmin, currentUserPubkey, isLoading: isRoleLoading } = useUserRole(config?.appPublicKey)
	const catalog = useExtensionCatalog(currentUserPubkey, amIAdmin)
	const servers = useServerMutations(currentUserPubkey)
	const builtins = useBuiltinMutations(currentUserPubkey)
	const bindingMutations = useBindingMutations(currentUserPubkey)
	const capabilitySuggestions = useMemo(() => {
		const used = [
			...(catalog.data?.entries ?? []).flatMap((entry) => entry.capabilities),
			...(catalog.data?.bindings ?? []).map((binding) => binding.capability),
		]
		return [...new Set(used)].sort()
	}, [catalog.data])
	const bindingControls = { ...bindingMutations, capabilitySuggestions }

	if (isRoleLoading) return <SettingsLoadingSkeleton />
	// Client-side workflow gate only; the catalog and store endpoints enforce admin auth themselves.
	if (!amIAdmin) return <SettingsAccessDenied header={header} message="Only marketplace admins can open the extension store." />

	const backLink = (
		<Button variant="ghost" asChild>
			<Link to="/dashboard/app-settings/extensions" data-testid="extension-store-back">
				<ArrowLeft className="mr-2 h-4 w-4" />
				Extensions
			</Link>
		</Button>
	)

	return (
		<div>
			<SettingsPageHeader {...header} actions={backLink} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...header} actions={backLink} />
				<ExtensionStoreView
					catalog={catalog.data}
					registryEnvExample={REGISTRY_ENV_EXAMPLE}
					servers={servers}
					builtins={builtins}
					bindingControls={bindingControls}
					isLoading={catalog.isFetching && !catalog.data}
					errorMessage={catalog.error ? extensionErrorMessage(catalog.error) : undefined}
					onRetry={() => void catalog.refetch()}
				/>
			</div>
		</div>
	)
}
