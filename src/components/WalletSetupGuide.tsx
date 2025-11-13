import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ExternalLinkIcon, WalletIcon, ZapIcon } from 'lucide-react'

interface WalletOption {
	name: string
	url: string
	description: string
	features: string[]
	type: 'Custodial Wallet' | 'Mobile App'
}

const walletOptions: WalletOption[] = [
	{
		name: 'Coinos',
		url: 'https://coinos.io/',
		description: 'Easy-to-use web-based wallet with instant setup',
		features: ['Lightning payments', 'Cashu support', 'No app installation needed', 'Beginner-friendly'],
		type: 'Custodial Wallet',
	},
	{
		name: 'npub.cash',
		url: 'https://npub.cash/',
		description: 'Nostr-native wallet that uses your npub identity',
		features: ['Lightning address', 'Cashu ecash', 'Integrated with Nostr', 'Quick setup'],
		type: 'Custodial Wallet',
	},
	{
		name: 'Minibits',
		url: 'https://www.minibits.cash/',
		description: 'Full-featured mobile wallet for Android and iOS',
		features: ['Lightning address', 'Cashu payments', 'Mobile app', 'Privacy-focused'],
		type: 'Mobile App',
	},
]

export function WalletSetupGuide() {
	const handleWalletClick = (url: string) => {
		window.open(url, '_blank', 'noopener,noreferrer')
	}

	return (
		<div className="space-y-6">
			<Card className="border-blue-200 bg-blue-50">
				<CardHeader>
					<div className="flex items-center gap-3">
						<WalletIcon className="w-8 h-8 text-blue-600" />
						<div>
							<CardTitle className="text-blue-900">Get Started with Bitcoin Payments</CardTitle>
							<CardDescription className="text-blue-700">
								To receive payments, you'll need a Bitcoin wallet. Choose one of these recommended options to get started.
							</CardDescription>
						</div>
					</div>
				</CardHeader>
			</Card>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				{walletOptions.map((wallet) => (
					<Card key={wallet.name} className="flex flex-col">
						<CardHeader>
							<div className="flex items-start justify-between">
								<div>
									<CardTitle className="text-lg">{wallet.name}</CardTitle>
									<p className="text-xs text-muted-foreground mt-1">{wallet.type}</p>
								</div>
								<ZapIcon className="w-5 h-5 text-orange-500" />
							</div>
							<CardDescription className="mt-2">{wallet.description}</CardDescription>
						</CardHeader>
						<CardContent className="flex-1">
							<div className="space-y-2">
								<p className="text-sm font-medium">Features:</p>
								<ul className="text-sm space-y-1">
									{wallet.features.map((feature, index) => (
										<li key={index} className="flex items-start gap-2">
											<span className="text-green-600 mt-0.5">✓</span>
											<span className="text-muted-foreground">{feature}</span>
										</li>
									))}
								</ul>
							</div>
						</CardContent>
						<CardFooter>
							<Button onClick={() => handleWalletClick(wallet.url)} className="w-full flex items-center justify-center gap-2">
								Get {wallet.name}
								<ExternalLinkIcon className="w-4 h-4" />
							</Button>
						</CardFooter>
					</Card>
				))}
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">What happens next?</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3 text-sm text-muted-foreground">
					<div className="flex gap-3">
						<span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
							1
						</span>
						<p>Choose a wallet and create your account following their setup instructions</p>
					</div>
					<div className="flex gap-3">
						<span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
							2
						</span>
						<p>Copy your Lightning address (looks like: yourname@wallet.com) or Bitcoin address</p>
					</div>
					<div className="flex gap-3">
						<span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
							3
						</span>
						<p>Return here and click "Add Payment Method" to paste your payment details</p>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
