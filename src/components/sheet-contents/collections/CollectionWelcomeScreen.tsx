import { Button } from '@/components/ui/button'

export function CollectionWelcomeScreen({ onGetStarted }: { onGetStarted: () => void }) {
	return (
		<div className="flex flex-col h-full justify-between items-center px-4 pb-12">
			<div />
			<div className="flex flex-col justify-center items-center gap-4">
				<div className="flex justify-center mt-8">
					<span className="text-6xl">📁</span>
				</div>

				<h1 className="text-2xl font-heading text-balance text-center">CREATE COLLECTION</h1>
				<h2 className="text-xl font-mono text-balance text-center text-gray-600">
					Organize your products
					<br />
					into collections
				</h2>
			</div>
			<div />
			<Button variant="secondary" className="w-full" onClick={onGetStarted}>
				GET STARTED
			</Button>
		</div>
	)
} 