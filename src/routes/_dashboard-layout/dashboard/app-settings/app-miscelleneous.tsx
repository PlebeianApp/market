import { Button } from '@/components/ui/button'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/app-miscelleneous')({
	component: AppMiscelleneousComponent,
})

function AppMiscelleneousComponent() {
	useDashboardTitle('App Miscellaneous')
	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">App Miscellaneous</h1>
				<div className="flex items-center gap-4">
					<Button
						onClick={() => console.log('action')}
						className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold"
					>
						App misc action
					</Button>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden space-y-4">
					<div>
						<p className="text-muted-foreground">Manage your shipping options for customers</p>
					</div>

					<Button
						onClick={() => console.log('action')}
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						Action
					</Button>
				</div>
			</div>
		</div>
	)
}
