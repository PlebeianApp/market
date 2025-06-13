import { createFileRoute } from '@tanstack/react-router'
import { Hero } from '../components/Hero'
import { Button } from '@/components/ui/button'
import { uiActions } from '@/lib/stores/ui'
import { authStore, useAuth } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'

export const Route = createFileRoute('/')({
	component: Index,
})

function Index() {
	const { isAuthenticated } = useStore(authStore)
	const handleStartSelling = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createProduct')
		} else {
			uiActions.openDialog('login')
		}
	}

	return (
		<div>
			<Hero>
				<div className="space-y-4 mb-6 px-6">
					<h1 className="text-3xl lg:text-5xl font-theylive">Buy & Sell Stuff with sats</h1>
				</div>
				<Button variant="focus" onClick={handleStartSelling}>
					<span className="flex items-center gap-2">
						<span className="i-nostr w-6 h-6"></span>Start Selling
					</span>
				</Button>
			</Hero>
		</div>
	)
}
