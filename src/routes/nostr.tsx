import { createFileRoute, Outlet } from '@tanstack/react-router'
import { ThreadOpenProvider } from '@/state/threadOpenStore'

// Layout route for all /nostr/* paths to ensure proper nesting and matching
export const Route = createFileRoute('/nostr')({
	component: () => (
		<ThreadOpenProvider>
			<Outlet />
		</ThreadOpenProvider>
	),
})
