import { ProductFormContent } from '@/components/sheet-contents/NewProductContent'
import { productFormActions } from '@/lib/stores/product'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products/new')({
	component: NewProductComponent,
})

function NewProductComponent() {
	useDashboardTitle('Add a Product')

	useEffect(() => {
		// Set to creation mode first
		productFormActions.setEditingProductId(null)

		// Try to load persisted state, otherwise reset
		productFormActions.loadPersistedState().catch(() => {
			// If loading fails, reset to default
			productFormActions.reset()
		})
	}, [])

	return (
		<div className="space-y-6">
			<ProductFormContent showFooter={true} />
		</div>
	)
}
