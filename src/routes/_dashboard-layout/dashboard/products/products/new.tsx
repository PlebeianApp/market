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
		// Reset form and set to creation mode when component mounts
		productFormActions.reset()
		productFormActions.setEditingProductId(null)
	}, [])

	return (
		<div className="space-y-6">
			<div className="bg-white rounded-md shadow-sm">
				<ProductFormContent showFooter={true} />
			</div>
		</div>
	)
}
