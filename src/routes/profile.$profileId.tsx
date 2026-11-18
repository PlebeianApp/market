import { StorefrontOrProfilePage } from '@/components/pages/StorefrontOrProfilePage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/profile/$profileId')({
	component: RouteComponent,
})

function RouteComponent() {
	const { profileId } = Route.useParams()
	return <StorefrontOrProfilePage profileId={profileId} />
}
