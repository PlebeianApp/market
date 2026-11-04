import { useConfigQuery } from '@/queries/config'
import { useUserRole } from '@/queries/app-settings'
import { extensionErrorMessage, useDescribeProductImage, useExtensionDescriptors } from '@/queries/extensions'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import {
	ExtensionCard,
	ExtensionsEmptyState,
	ImageDescribePanel,
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
	SettingsMobileHeader,
	SettingsPageHeader,
} from '@ui/index'
import { createFileRoute } from '@tanstack/react-router'
import { Puzzle } from 'lucide-react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/extensions')({
	component: ExtensionsComponent,
})

const header = { icon: Puzzle, title: 'Extensions', description: 'Extensions enabled on this marketplace' }
const ENV_EXAMPLE = 'EXTENSION_PRODUCT_IMAGE_DESCRIBER_ENABLED=true'

function ExtensionsComponent() {
	useDashboardTitle('Extensions')
	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isRoleLoading } = useUserRole(config?.appPublicKey)
	const { descriptors, isLoading } = useExtensionDescriptors()
	const describe = useDescribeProductImage()

	if (isLoading || isRoleLoading) return <SettingsLoadingSkeleton />
	// Client-side workflow gate only; the action route enforces its own auth and roles.
	if (!amIAdmin) return <SettingsAccessDenied header={header} message="Only marketplace admins can view extensions." />

	return (
		<div>
			<SettingsPageHeader {...header} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...header} />

				{descriptors.length === 0 ? (
					<ExtensionsEmptyState envExample={ENV_EXAMPLE} />
				) : (
					<div className="grid gap-4 xl:grid-cols-2" data-testid="extension-list">
						{descriptors.map((descriptor) => (
							<ExtensionCard key={descriptor.id} descriptor={descriptor} />
						))}
					</div>
				)}

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
