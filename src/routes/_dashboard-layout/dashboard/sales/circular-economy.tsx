import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useV4VManager } from '@/hooks/useV4VManager'
import { V4VManager } from '@/components/v4v/V4VManager'
import { authStore } from '@/lib/stores/auth'
import { createFileRoute } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useStore } from '@tanstack/react-store'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/circular-economy')({
	component: CircularEconomyComponent,
})

function CircularEconomyComponent() {
	useDashboardTitle('Circular Economy')
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Circular Economy</h1>
			</div>
			<div className="space-y-6 p-4 lg:p-6">
				{/* <Card className="bg-blue-50 border-blue-200">
					<CardContent className="pt-6">
						<p className="text-blue-800">
							PM (Beta) Is Powered By Your Generosity. Your Contribution Is The Only Thing That Enables Us To Continue Creating Free And Open
							Source Solutions 🙏
						</p>
					</CardContent>
				</Card> */}

				<V4VManager userPubkey={userPubkey} />
			</div>
		</div>
	)
}
