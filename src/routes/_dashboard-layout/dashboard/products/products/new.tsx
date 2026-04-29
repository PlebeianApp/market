import { ProductCreateShell } from '@/components/product-authoring/ProductCreateShell'
import { authStore } from '@/lib/stores/auth'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products/new')({
	component: NewProductComponent,
})

function NewProductComponent() {
	useDashboardTitle('Add a Product')

	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey ?? ''

	return <ProductCreateShell userPubkey={userPubkey} entrypoint="dashboard" className="space-y-6" />
}
