import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Link } from '@tanstack/react-router'

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
	component: HomeRoute,
})

function HomeRoute() {
	const { isAuthenticated } = useStore(authStore)
	const [animationParent] = useAutoAnimate()

	// Use the market image for homepage background
	const marketBackgroundImageUrl = '/images/market-background.jpg'
	const marketHeroClassName = 'hero-bg-market-homepage'
	useHeroBackground(marketBackgroundImageUrl, marketHeroClassName)

	const handleStartSelling = () => {
		if (!isAuthenticated) {
			uiActions.openDialog('login')
		} else {
			uiActions.openDrawer('createProduct')
		}
	}

	return (
		<div className="flex flex-col min-h-screen">
			<div className="flex-grow flex flex-col">
				<div className="flex-grow flex flex-col items-center justify-center text-center px-4 py-16 bg-gradient-to-b from-black to-transparent">
					<div className="max-w-3xl mx-auto">
						<h1 className="text-4xl sm:text-6xl font-bold mb-6 text-white">
							The Marketplace for <span className="text-focus">Bitcoiners</span>
						</h1>
						<p className="text-lg sm:text-xl mb-8 text-white/80">
							Buy and sell products using Bitcoin and Lightning Network. Connect with other Bitcoiners and grow the circular economy.
						</p>
						<div className="flex flex-col sm:flex-row gap-4 justify-center">
							<Button variant="focus" size="lg" onClick={handleStartSelling}>
								<span className="flex items-center gap-2" ref={animationParent}>
									<span className="i-nostr w-6 h-6"></span>
									{isAuthenticated ? 'Add A Product' : 'Start Selling'}
								</span>
							</Button>
							<Button variant="secondary" size="lg" asChild>
								<Link to="/products">Browse Products</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
