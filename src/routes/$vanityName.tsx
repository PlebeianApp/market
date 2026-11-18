import { VanityStorefrontPage } from '@/components/pages/VanityStorefrontPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$vanityName')({
	component: VanityRouteComponent,
})

function VanityRouteComponent() {
	const { vanityName } = Route.useParams()
	return <VanityStorefrontPage name={vanityName} />
}
