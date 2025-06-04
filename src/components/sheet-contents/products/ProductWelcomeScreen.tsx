import { Button } from '@/components/ui/button'

export function ProductWelcomeScreen({ onGetStarted }: { onGetStarted: () => void }) {
	return (
		<div className="flex flex-col h-full justify-between items-center px-4 pb-12">
			{/* Spacer */}
			<div />
			<div className="flex flex-col justify-center items-center gap-4">
				<div className="flex justify-center mt-8">
					<img src="/images/logo.svg" alt="Plebeian Market Logo" className="w-16 h-16" />
				</div>

				<h1 className="text-2xl font-heading text-balance text-center">WELCOME TO</h1>
				<h1 className="text-2xl font-heading text-balance text-center">PLEBEIAN MARKET</h1>
				<h2 className="text-xl font-mono text-balance text-center text-gray-600">
					Start selling your products
					<br />
					in just a few minutes
				</h2>
			</div>
			{/* Spacer */}
			<div />
			<Button variant="secondary" className="w-full" onClick={onGetStarted}>
				LET'S GO
			</Button>
		</div>
	)
}
