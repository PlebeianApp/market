import { createFileRoute, useParams } from '@tanstack/react-router'

export const Route = createFileRoute('/nostr/thread')({
	component: NostrThreadComponent,
})

function NostrThreadComponent() {
	const { threadRoot } = useParams({ from: '/nostr/$threadRoot' })
	return <div>nostr thread view: {threadRoot}</div>
}
