import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

// Hook to inject dynamic CSS for background image
function useHeroBackground(imageUrl: string, className: string) {
	useEffect(() => {
		if (!imageUrl) return

		const style = document.createElement('style')
		style.textContent = `
			.${className} {
				background-image: url(${imageUrl}) !important;
			}
		`
		document.head.appendChild(style)

		return () => {
			document.head.removeChild(style)
		}
	}, [imageUrl, className])
}

export const Route = createFileRoute('/')({
	component: Index,
})

function Index() {
	const { isAuthenticated } = useStore(authStore)

	// Use the market image for homepage background
	const marketBackgroundImageUrl = '/images/market-background.jpg'
	const marketHeroClassName = 'hero-bg-market-homepage'
	useHeroBackground(marketBackgroundImageUrl, marketHeroClassName)

	const handleStartSelling = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createProduct')
		} else {
			uiActions.openDialog('login')
		}
	}

	return (
		<div>
			{/* Use products page banner styling */}
			<div className={`relative hero-container ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-black'}`}>
				<div className="hero-overlays">
					<div className="absolute inset-0 bg-radial-overlay z-10" />
					<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
				</div>

				<div className="hero-content">
					<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-16 lg:mt-0">
						<div className="flex items-center justify-center h-24 lg:h-32 px-6">
							<h1 className="text-4xl lg:text-5xl font-theylive transition-opacity duration-500">Buy & Sell Stuff with sats</h1>
						</div>

						<div className="flex flex-col gap-6">
							<Button variant="focus" size="lg" onClick={handleStartSelling}>
								<span className="flex items-center gap-2">
									<span className="i-nostr w-6 h-6"></span>Start Selling
								</span>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
