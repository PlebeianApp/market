import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/nostr/')({
	component: RouteComponent,
})

function RouteComponent() {
	return <div>Hello "/nostr/"!</div>
}
