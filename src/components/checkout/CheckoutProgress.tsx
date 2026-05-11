import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ChevronLeft } from 'lucide-react'

interface CheckoutProgressProps {
	currentStepNumber: number
	totalSteps: number
	progress: number
	stepDescription: string
	onBackClick: () => void
	showBackButton?: boolean
}

export function CheckoutProgress({
	currentStepNumber,
	totalSteps,
	progress,
	stepDescription,
	onBackClick,
	showBackButton = true,
}: CheckoutProgressProps) {
	return (
		<div className="sticky top-0 z-50 bg-white flex flex-row items-center gap-3 px-4 py-3 lg:gap-4 lg:p-4">
			{showBackButton && (
				<Button variant="ghost" onClick={onBackClick} className="flex-shrink-0 h-8 px-2 lg:h-10 lg:px-3" aria-label="Go back in checkout">
					<ChevronLeft className="h-4 w-4" />
					<span className="ml-1 text-sm">Back</span>
				</Button>
			)}
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
