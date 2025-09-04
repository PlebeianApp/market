import { createFileRoute, Outlet } from '@tanstack/react-router'

// Layout route for all /nostr/* paths to ensure proper nesting and matching
export const Route = createFileRoute('/nostr')({
	component: () => <Outlet />,
})
