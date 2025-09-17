import { V4VManager } from '@/components/v4v/V4VManager'
import { authStore } from '@/lib/stores/auth'
import { useV4VShares } from '@/queries/v4v'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useMemo } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/circular-economy')({
	component: CircularEconomyComponent,
})

function CircularEconomyComponent() {
	useDashboardTitle('Circular Economy')
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	// Fetch existing V4V shares
	const { data: v4vShares, isLoading } = useV4VShares(userPubkey)

	// Calculate initial values from fetched shares
	const { initialShares, initialTotalPercentage } = useMemo(() => {
		if (!v4vShares || v4vShares.length === 0) {
			// No shares configured - use defaults
			return { initialShares: [], initialTotalPercentage: 10 }
		}

		// Calculate total V4V percentage (sum of all share percentages)
		// Shares are stored as decimals (0.1 = 10% of total sales)
		const totalPercentage = v4vShares.reduce((sum, share) => sum + share.percentage, 0) * 100

		// Normalize shares to sum to 1 (for the split between recipients in the UI)
		const totalSharePercentage = v4vShares.reduce((sum, share) => sum + share.percentage, 0)
		const normalizedShares = v4vShares.map((share) => ({
			...share,
			percentage: share.percentage / totalSharePercentage,
		}))

		return {
			initialShares: normalizedShares,
			initialTotalPercentage: totalPercentage,
		}
	}, [v4vShares])

	if (isLoading) {
		return (
			<div>
				<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
					<h1 className="text-2xl font-bold">Circular Economy</h1>
				</div>
				<div className="space-y-6 p-4 lg:p-6">
					<p>Loading V4V settings...</p>
				</div>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b h-[73px] px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Circular Economy</h1>
			</div>
			<div className="space-y-6 pt-4 px-4 xl:px-6 pb-6">
				<V4VManager
					userPubkey={userPubkey}
					initialShares={initialShares}
					initialTotalPercentage={initialTotalPercentage}
					showChangesIndicator={false}
					saveButtonText="Save Changes"
				/>
			</div>
		</div>
	)
}
