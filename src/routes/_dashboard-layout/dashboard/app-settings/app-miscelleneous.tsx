import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { submitAppSettings } from '@/lib/appSettings'
import { createQueryClient } from '@/lib/queryClient'
import { useUserRole } from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { configKeys } from '@/queries/queryKeyFactory'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createHandlerInfoEventData } from '@/publish/nip89'
import { createFileRoute } from '@tanstack/react-router'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { useState } from 'react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/app-miscelleneous')({
	component: AppMiscelleneousComponent,
})

function AppMiscelleneousComponent() {
	useDashboardTitle('App Miscellaneous')
	const { data: config } = useConfigQuery()
	const { amIAdmin, amIOwner, isLoading: isRoleLoading } = useUserRole(config?.appPublicKey)
	const [isSubmitting, setIsSubmitting] = useState(false)

	const canManageSettings = amIAdmin || amIOwner

	const handleShowNostrLinkChange = async (checked: boolean) => {
		if (!config?.appSettings || !config?.appRelay || !config?.appPublicKey) {
			toast.error('Configuration not loaded')
			return
		}

		setIsSubmitting(true)
		try {
			const updatedSettings = {
				...config.appSettings,
				showNostrLink: checked,
			}

			// Use a fixed handler ID for consistency
			const handlerId = 'plebeian-market-handler'
			let handlerEvent = createHandlerInfoEventData(config.appSettings.ownerPk, updatedSettings, config.appRelay, handlerId)
			handlerEvent = finalizeEvent(handlerEvent, generateSecretKey())
			await submitAppSettings(handlerEvent)

			// Wait a bit for the events to be processed
			await new Promise((resolve) => setTimeout(resolve, 1000))

			const queryClient = await createQueryClient([config.appRelay])
			await queryClient.invalidateQueries({ queryKey: configKeys.all })
			await queryClient.refetchQueries({ queryKey: configKeys.all })

			toast.success('Settings updated successfully!')
		} catch (error) {
			console.error('Failed to update settings:', error)
			if (error instanceof Error) {
				toast.error(error.message)
			} else {
				toast.error('Failed to update settings')
			}
		} finally {
			setIsSubmitting(false)
		}
	}

	if (isRoleLoading) {
		return (
			<div className="p-4 lg:p-6">
				<div className="animate-pulse">Loading...</div>
			</div>
		)
	}

	if (!canManageSettings) {
		return (
			<div className="p-4 lg:p-6">
				<div className="text-muted-foreground">You don't have permission to manage these settings.</div>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">App Miscellaneous</h1>
			</div>
			<div className="space-y-6 pt-4 px-4 xl:px-6">
				<div className="lg:hidden space-y-4">
					<div>
						<p className="text-muted-foreground">Manage miscellaneous app settings</p>
					</div>
				</div>

				<div className="space-y-6">
					<div className="border rounded-lg p-4 space-y-4">
						<h3 className="text-lg font-semibold">Navigation Settings</h3>
						<p className="text-sm text-muted-foreground">Configure which links appear in the main navigation.</p>

						<div className="flex items-center space-x-3">
							<Checkbox
								id="showNostrLink"
								checked={config?.appSettings?.showNostrLink ?? false}
								onCheckedChange={handleShowNostrLinkChange}
								disabled={isSubmitting}
							/>
							<div className="space-y-1">
								<Label htmlFor="showNostrLink" className="font-medium cursor-pointer">
									Show Nostr link in navigation
								</Label>
								<p className="text-sm text-muted-foreground">When enabled, a "Nostr" link will appear in the main navigation menu.</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
