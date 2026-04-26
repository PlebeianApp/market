import { ProductFormContent } from '@/components/sheet-contents/NewProductContent'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { authStore } from '@/lib/stores/auth'
import { resolveProductWorkflow } from '@/lib/workflow/productWorkflowResolver'
import { useProductCreateReadiness } from '@/lib/workflow/useProductCreateReadiness'
import { productFormActions } from '@/lib/stores/product'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useRef, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products/new')({
	component: NewProductComponent,
})

function NewProductComponent() {
	useDashboardTitle('Add a Product')

	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey ?? ''
	const [isBootstrapped, setIsBootstrapped] = useState(false)
	const hasBootstrappedRef = useRef(false)

	const readiness = useProductCreateReadiness(userPubkey)

	const workflow = useMemo(
		() =>
			resolveProductWorkflow({
				mode: 'create',
				shippingState: readiness.shippingState,
				v4vConfigurationState: readiness.v4vConfigurationState,
			}),
		[readiness.shippingState, readiness.v4vConfigurationState],
	)

	useEffect(() => {
		hasBootstrappedRef.current = false
		setIsBootstrapped(false)
	}, [userPubkey])

	useEffect(() => {
		if (!workflow.isBootstrapReady || hasBootstrappedRef.current) return

		productFormActions.reset({
			activeTab: workflow.initialTab,
			editingProductId: null,
		})

		hasBootstrappedRef.current = true
		setIsBootstrapped(true)
	}, [workflow.initialTab, workflow.isBootstrapReady])

	if (!workflow.isBootstrapReady || !isBootstrapped) {
		return (
			<Card>
				<CardContent className="p-8">
					<div className="space-y-4">
						<Skeleton className="h-8 w-48" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
					</div>
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-6">
			<ProductFormContent showFooter={true} workflow={workflow} />
		</div>
	)
}
