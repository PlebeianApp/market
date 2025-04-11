import { createFileRoute } from '@tanstack/react-router'
import { Hero } from '../components/Hero'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/')({
	component: Index,
})

function Index() {
	const handleStartSelling = () => {
		if (window.openNewProductDialog) {
			window.openNewProductDialog()
		}
	}

	return (
		<div>
			<Hero>
				<div className="relative z-10 flex flex-col lg:flex-row items-center justify-center gap-4 lg:gap-4 mb-6 p-2">
					<img src="/images/buy-sell.svg" alt="Buy Sell Stuff for Sats" className="lg:h-[45px] w-auto" />
					<img src="/images/stuff-for-sats.svg" alt="Buy Sell Stuff for Sats" className="lg:h-[45px] w-auto" />
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
