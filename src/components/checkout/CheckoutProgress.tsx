import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ChevronLeft } from 'lucide-react'

interface CheckoutProgressProps {
	currentStepNumber: number
	totalSteps: number
	progress: number
	stepDescription: string
	onBackClick: () => void
}

export function CheckoutProgress({ currentStepNumber, totalSteps, progress, stepDescription, onBackClick }: CheckoutProgressProps) {
	return (
		<div className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm flex flex-row items-center gap-4 p-4">
			<Button variant="ghost" size="icon" onClick={onBackClick} className="flex-shrink-0">
				<ChevronLeft className="h-4 w-4" />
			</Button>
			<div className="flex-1">
				<div className="flex items-center justify-between text-sm text-gray-600 mb-2">
					<span>
						{currentStepNumber}/{totalSteps}
					</span>
					<span>{stepDescription}</span>
				</div>
				<Progress value={progress} className="h-2" />
			</div>
		</div>
	)
}
