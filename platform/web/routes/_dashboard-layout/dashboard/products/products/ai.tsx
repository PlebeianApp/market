import { AiProductWizard } from '@/components/products/AiProductWizard'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products/ai')({
	component: AiProductComponent,
})

function AiProductComponent() {
	useDashboardTitle('Create with AI')
	const navigate = useNavigate()
	return (
		<div className="p-4 lg:p-6">
			<AiProductWizard onPublished={() => navigate({ to: '/dashboard/products/products' })} />
		</div>
	)
}
