import { ProductFormContent } from '@/components/sheet-contents/NewProductContent'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { resolveProductWorkflow, type V4VSetupState } from '@/lib/workflow/productWorkflowResolver'
import { useV4VConfiguration } from '@/queries/v4v'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useLayoutEffect, useMemo, useRef } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products/new')({
	component: NewProductComponent,
})

function NewProductComponent() {
	useDashboardTitle('Add a Product')

	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey ?? ''
	const hasBootstrappedRef = useRef(false)

	const v4vQuery = useV4VConfiguration(userPubkey)

	const v4vState = useMemo<V4VSetupState>(() => {
		if (!userPubkey) return 'loading'
		if (v4vQuery.isLoading) return 'loading'

		return v4vQuery.data?.state ?? 'unknown'
	}, [userPubkey, v4vQuery.data?.state, v4vQuery.isLoading])

	const workflow = useMemo(
		() =>
			resolveProductWorkflow({
				mode: 'create',
				v4vConfigurationState: v4vState,
			}),
		[v4vState],
	)

	useLayoutEffect(() => {
		hasBootstrappedRef.current = false
	}, [userPubkey])

	useLayoutEffect(() => {
		if (hasBootstrappedRef.current) return

		productFormActions.reset({
			activeTab: workflow.initialTab,
			editingProductId: null,
		})

		hasBootstrappedRef.current = true
	}, [userPubkey, workflow.initialTab])

	return (
		<div className="space-y-6">
			<ProductFormContent showFooter={true} workflow={workflow} />
		</div>
	)
}
