import { RelayManager } from '@/components/ui/relay-manager'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { Globe } from 'lucide-react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/blacklists')({
	component: BlacklistsComponent,
})

function BlacklistsComponent() {
	useDashboardTitle('Blacklists')
	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<div className="flex items-center gap-3">
					<Globe className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Blacklists</h1>
						<p className="text-muted-foreground text-sm">Manage your blacklists</p>
					</div>
				</div>
			</div>
			<div className="p-4 lg:p-8">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<Globe className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Blacklists</h1>
							<p className="text-muted-foreground text-sm">Manage your blacklists</p>
						</div>
					</div>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div className="bg-white p-4 rounded-lg shadow-sm">
						<h2 className="text-lg font-semibold mb-2">Blacklists</h2>
						<p className="text-sm text-muted-foreground">Manage your blacklists</p>
					</div>
				</div>
			</div>
		</div>
	)
}
