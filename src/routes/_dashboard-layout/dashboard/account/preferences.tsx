import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { uiActions, uiStore } from '@/lib/stores/ui'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useStore } from '@tanstack/react-store'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, Settings } from 'lucide-react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/preferences')({
	component: PreferencesComponent,
})

function PreferencesComponent() {
	useDashboardTitle('Preferences')
	const { showNSFWContent } = useStore(uiStore)

	const handleNSFWToggle = (checked: boolean) => {
		if (checked) {
			uiActions.openNSFWConfirmation()
		} else {
			uiActions.disableNSFWContent()
		}
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<div className="flex items-center gap-3">
					<Settings className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Preferences</h1>
						<p className="text-muted-foreground text-sm">Manage your browsing preferences</p>
					</div>
				</div>
			</div>
			<div className="p-4 lg:p-8">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<Settings className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Preferences</h1>
							<p className="text-muted-foreground text-sm">Manage your browsing preferences</p>
						</div>
					</div>
				</div>

				<div className="max-w-2xl space-y-8">
					{/* Content Settings Section */}
					<div className="space-y-4">
						<h2 className="text-lg font-semibold border-b pb-2">Content Settings</h2>

						{/* NSFW Toggle */}
						<div className="flex items-start justify-between p-4 border rounded-lg bg-amber-50/50 border-amber-200">
							<div className="space-y-1 pr-4">
								<div className="flex items-center gap-2">
									<AlertTriangle className="w-4 h-4 text-amber-600" />
									<Label htmlFor="nsfw-toggle" className="text-sm font-medium cursor-pointer">
										Show adult content
									</Label>
								</div>
								<p className="text-xs text-muted-foreground">
									Enable this to view products marked as containing adult or sensitive content, including NSFW material, alcohol, tobacco,
									weapons, and other age-restricted items.
								</p>
							</div>
							<Switch id="nsfw-toggle" checked={showNSFWContent} onCheckedChange={handleNSFWToggle} />
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
