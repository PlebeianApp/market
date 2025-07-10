import { RelayManager } from '@/components/ui/relay-manager'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { Globe } from 'lucide-react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/network')({
	component: NetworkComponent,
})

function NetworkComponent() {
	useDashboardTitle('Network')
	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<div className="flex items-center gap-3">
					<Globe className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Network</h1>
						<p className="text-muted-foreground text-sm">Manage your Nostr relay connections</p>
					</div>
				</div>
			</div>
			<div className="p-4 lg:p-8">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<Globe className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Network</h1>
							<p className="text-muted-foreground text-sm">Manage your Nostr relay connections</p>
						</div>
					</div>
				</div>
				<RelayManager />
			</div>
		</div>
	)
}
