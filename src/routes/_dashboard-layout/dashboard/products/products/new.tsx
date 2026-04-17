import { ProductFormContent } from '@/components/sheet-contents/NewProductContent'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { authStore } from '@/lib/stores/auth'
import { resolveProductWorkflow, type ShippingSetupState, type V4VSetupState } from '@/lib/workflow/productWorkflowResolver'
import { productFormActions } from '@/lib/stores/product'
import { createShippingReference, getShippingInfo, isShippingDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useV4VConfiguration } from '@/queries/v4v'
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

	const shippingQuery = useShippingOptionsByPubkey(userPubkey)
	const v4vQuery = useV4VConfiguration(userPubkey)

	const shippingState = useMemo<ShippingSetupState>(() => {
		if (!userPubkey) return 'loading'
		if (!shippingQuery.isFetched) return shippingQuery.isLoading ? 'loading' : 'unknown'

		const activeShippingRefs = new Set(
			(shippingQuery.data ?? [])
				.filter((event) => {
					const dTag = event.tags?.find((tag: string[]) => tag[0] === 'd')?.[1]
					return dTag ? !isShippingDeleted(dTag, event.created_at) : true
				})
				.map((event) => {
					const info = getShippingInfo(event)
					return info ? createShippingReference(event.pubkey, info.id) : null
				})
				.filter((shippingRef): shippingRef is string => !!shippingRef),
		)

		return activeShippingRefs.size === 0 ? 'empty' : 'ready'
	}, [userPubkey, shippingQuery.data, shippingQuery.isFetched, shippingQuery.isLoading])

	const v4vState = useMemo<V4VSetupState>(() => {
		if (!userPubkey) return 'loading'
		if (v4vQuery.isLoading) return 'loading'

		return v4vQuery.data?.state ?? 'unknown'
	}, [userPubkey, v4vQuery.data?.state, v4vQuery.isLoading])

	const workflow = useMemo(
		() =>
			resolveProductWorkflow({
				mode: 'create',
				shippingState,
				v4vConfigurationState: v4vState,
			}),
		[shippingState, v4vState],
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
