import { useConfigQuery } from '@/queries/config'
import { useUserRole } from '@/queries/app-settings'
import {
	extensionErrorMessage,
	useBindingMutations,
	useDescribeProductImage,
	useExtensionCatalog,
	useExtensionDescriptors,
	useRemoteActionInvoke,
} from '@/queries/extensions'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import {
	ExtensionCard,
	ImageDescribePanel,
	RemoteActionTryPanel,
	RepositoryEntryCard,
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
} from '@ui/index'
import { Button } from '@ui/primitives/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Puzzle } from 'lucide-react'
import { parseRemoteExtensionId } from '@sdk/core/extensions'
import { PRODUCT_IMAGE_DESCRIBE_CAPABILITY } from '@sdk/extensions/product-image-describer'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/extensions/$extensionId')({
	component: ExtensionPageComponent,
})

const header = { icon: Puzzle, title: 'Extension', description: 'Extension details' }

/** One added extension: built-in details and its try panel, or an external extension's bound actions. */
function ExtensionPageComponent() {
	const { extensionId } = Route.useParams()
	const { data: config } = useConfigQuery()
	const { amIAdmin, currentUserPubkey, isLoading: isRoleLoading } = useUserRole(config?.appPublicKey)
	const { descriptors, isLoading } = useExtensionDescriptors()
	const serverPubkey = parseRemoteExtensionId(extensionId)
	const catalog = useExtensionCatalog(currentUserPubkey, amIAdmin && Boolean(serverPubkey))
	const bindingControls = useBindingMutations(currentUserPubkey)
	const describe = useDescribeProductImage()
	const remoteInvoke = useRemoteActionInvoke()

	const descriptor = descriptors.find((item) => item.id === extensionId)
	const entry = serverPubkey
		? catalog.data?.repository?.entries.find((item) => item.serverPubkey === serverPubkey && item.added)
		: undefined
	useDashboardTitle(entry?.name ?? descriptor?.displayName ?? 'Extension')

	if (isLoading || isRoleLoading || (serverPubkey && catalog.isFetching && !catalog.data)) return <SettingsLoadingSkeleton />
	if (!amIAdmin) return <SettingsAccessDenied header={header} message="Only marketplace admins can view extensions." />

	if (!serverPubkey) {
		if (!descriptor) return <NotAdded />
		return (
			<div className="space-y-4" data-testid="extension-page">
				<ExtensionCard descriptor={descriptor} />
				{descriptor.capabilities.includes(PRODUCT_IMAGE_DESCRIBE_CAPABILITY) && describe.available && (
					<ImageDescribePanel
						pending={describe.isPending}
						result={describe.data}
						errorMessage={describe.error ? extensionErrorMessage(describe.error) : undefined}
						onDescribe={(request) => describe.mutate(request)}
					/>
				)}
			</div>
		)
	}

	if (!entry) return <NotAdded />
	const bindings = (catalog.data?.bindings ?? []).filter((binding) => binding.serverPubkey === serverPubkey)
	const actions = (descriptor?.actions ?? []).map((action) => ({ extensionId, actionName: action.name, label: action.name }))

	return (
		<div className="space-y-4" data-testid="extension-page">
			<ul>
				<RepositoryEntryCard entry={entry} bindings={bindings} bindingControls={bindingControls} />
			</ul>
			{actions.length === 0 && (
				<p className="text-sm text-muted-foreground">
					No active actions. Accept its suggested bindings in the{' '}
					<Link to="/dashboard/app-settings/extension-store" className="underline">
						Extension store
					</Link>
					.
				</p>
			)}
			<RemoteActionTryPanel
				actions={actions}
				pending={remoteInvoke.isPending}
				result={remoteInvoke.data}
				errorMessage={remoteInvoke.error ? extensionErrorMessage(remoteInvoke.error) : undefined}
				onRun={(option, input) => remoteInvoke.mutate({ extensionId: option.extensionId, actionName: option.actionName, input })}
			/>
		</div>
	)
}

function NotAdded() {
	return (
		<div className="space-y-3 py-8 text-center" data-testid="extension-not-added">
			<p className="font-medium">This extension is not added to the marketplace.</p>
			<Button variant="outline" asChild>
				<Link to="/dashboard/app-settings/extension-store">Open the Extension store</Link>
			</Button>
		</div>
	)
}
