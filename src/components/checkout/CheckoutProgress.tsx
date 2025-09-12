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
		<div className="sticky top-0 z-50 bg-white flex flex-row items-center gap-3 px-4 py-3 lg:gap-4 lg:p-4">
			<Button variant="ghost" size="icon" onClick={onBackClick} className="flex-shrink-0 h-8 w-8 lg:h-10 lg:w-10">
				<ChevronLeft className="h-4 w-4" />
			</Button>
			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between text-xs lg:text-sm text-gray-600 mb-1 lg:mb-2">
					<span className="font-medium">
						{currentStepNumber}/{totalSteps}
					</span>
					<span className="truncate ml-2">{stepDescription}</span>
				</div>
				<Progress value={progress} className="h-1.5 lg:h-2" />
			</div>
		</div>
	)
}
