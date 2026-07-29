import { V4VManager } from '@/components/v4v/V4VManager'
import { salesV4VConfig, salesV4VLabels } from '@/lib/v4v/labels'
import { salesV4VManagerProps } from '@/lib/v4v/sales-props'
import { deriveInitialSharesFromStored } from '@/lib/v4v/splits'
import { authStore } from '@/lib/stores/auth'
import { useV4VManager } from '@/hooks/useV4VManager'
import { useV4VShares } from '@/queries/v4v'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useMemo } from 'react'

// Sales-only emoji animation styles. Imported here (at the call site) rather
// than inside the agnostic V4VManager so the component stays free of
// product-specific styling.
import '@/routes/_dashboard-layout/dashboard/sales/emoji-animations.css'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/circular-economy')({
	component: CircularEconomyComponent,
})

function CircularEconomyComponent() {
	useDashboardTitle('Circular Economy')
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	// Fetch existing V4V shares
	const { data: v4vShares, isLoading } = useV4VShares(userPubkey)

	// Derive editor boot values from stored shares (shared helper, no duplication).
	const { initialShares, initialTotalPercentage } = useMemo(() => deriveInitialSharesFromStored(v4vShares), [v4vShares])

	// The sales / "all products" adapter — owns state, defaults, emoji, and
	// persistence to kind 30078. The route injects its output into the agnostic
	// V4VManager below, which is what declares this view is specifically for sales.
	const sales = useV4VManager({ userPubkey, initialShares, initialTotalPercentage })

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
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Circular Economy</h1>
			</div>
			<div className="space-y-6 p-4 lg:p-6">
				<V4VManager {...salesV4VManagerProps(sales)} labels={salesV4VLabels} config={salesV4VConfig} />
			</div>
		</div>
	)
}
