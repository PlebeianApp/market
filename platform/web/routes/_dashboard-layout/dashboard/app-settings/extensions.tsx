import { useConfigQuery } from '@/queries/config'
import { useUserRole } from '@/queries/app-settings'
import {
	extensionErrorMessage,
	useDescribeProductImage,
	useExtensionCatalog,
	useBindingMutations,
	useExtensionDescriptors,
	useRemoteActionInvoke,
	useSideloadMutations,
} from '@/queries/extensions'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import {
	ExtensionCard,
	ExtensionsEmptyState,
	ExtensionStoreButton,
	ExtensionStoreDialog,
	ImageDescribePanel,
	RemoteActionTryPanel,
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
	SettingsMobileHeader,
	SettingsPageHeader,
} from '@ui/index'
import { createFileRoute } from '@tanstack/react-router'
import { Puzzle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { REMOTE_EXTENSION_PREFIX } from '@sdk/core/extensions'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/extensions')({
	component: ExtensionsComponent,
})

const header = { icon: Puzzle, title: 'Extensions', description: 'Extensions enabled on this marketplace' }
const ENV_EXAMPLE = 'EXTENSION_PRODUCT_IMAGE_DESCRIBER_ENABLED=true'
const REGISTRY_ENV_EXAMPLE =
	'EXTENSIONS_REGISTRY_CURATORS=npub1…\n# optional, defaults to the app relay\nEXTENSIONS_REGISTRY_RELAYS=wss://relay.example'

function ExtensionsComponent() {
	useDashboardTitle('Extensions')
	const { data: config } = useConfigQuery()
	const { amIAdmin, currentUserPubkey, isLoading: isRoleLoading } = useUserRole(config?.appPublicKey)
	const { descriptors, isLoading } = useExtensionDescriptors()
	const describe = useDescribeProductImage()
	const [storeOpen, setStoreOpen] = useState(false)
	const catalog = useExtensionCatalog(currentUserPubkey, storeOpen && amIAdmin)
	const sideload = useSideloadMutations(currentUserPubkey)
	const bindingControls = useBindingMutations(currentUserPubkey)
	const remoteInvoke = useRemoteActionInvoke()
	const remoteActions = useMemo(
		() =>
			descriptors
				.filter((descriptor) => descriptor.id.startsWith(REMOTE_EXTENSION_PREFIX))
				.flatMap((descriptor) =>
					descriptor.actions.map((action) => ({
						extensionId: descriptor.id,
						actionName: action.name,
						label: `${descriptor.displayName} — ${action.name}`,
					})),
				),
		[descriptors],
	)

	if (isLoading || isRoleLoading) return <SettingsLoadingSkeleton />
	// Client-side workflow gate only; the action route enforces its own auth and roles.
	if (!amIAdmin) return <SettingsAccessDenied header={header} message="Only marketplace admins can view extensions." />

	const storeButton = <ExtensionStoreButton onClick={() => setStoreOpen(true)} />

	return (
		<div>
			<SettingsPageHeader {...header} actions={storeButton} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...header} actions={storeButton} />
				<ExtensionStoreDialog
					open={storeOpen}
					onOpenChange={setStoreOpen}
					catalog={catalog.data}
					registryEnvExample={REGISTRY_ENV_EXAMPLE}
					sideload={sideload}
					bindingControls={bindingControls}
					isLoading={catalog.isFetching && !catalog.data}
					errorMessage={catalog.error ? extensionErrorMessage(catalog.error) : undefined}
					onRetry={() => void catalog.refetch()}
				/>

				{descriptors.length === 0 ? (
					<ExtensionsEmptyState envExample={ENV_EXAMPLE} />
				) : (
					<div className="grid gap-4 xl:grid-cols-2" data-testid="extension-list">
						{descriptors.map((descriptor) => (
							<ExtensionCard key={descriptor.id} descriptor={descriptor} />
						))}
					</div>
				)}

				<RemoteActionTryPanel
					actions={remoteActions}
					pending={remoteInvoke.isPending}
					result={remoteInvoke.data}
					errorMessage={remoteInvoke.error ? extensionErrorMessage(remoteInvoke.error) : undefined}
					onRun={(option, input) => remoteInvoke.mutate({ extensionId: option.extensionId, actionName: option.actionName, input })}
				/>

				{describe.available && (
					<ImageDescribePanel
						pending={describe.isPending}
						result={describe.data}
						errorMessage={describe.error ? extensionErrorMessage(describe.error) : undefined}
						onDescribe={(request) => describe.mutate(request)}
					/>
				)}
			</div>
		</div>
	)
}
