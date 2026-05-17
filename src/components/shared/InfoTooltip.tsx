import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface InfoTooltipProps {
	content: string
	className?: string
}

export function InfoTooltip({ content, className }: InfoTooltipProps) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className={`inline-flex items-center justify-center rounded-full w-5 h-5 text-gray-500 hover:text-gray-700 ${className}`}
						aria-label="More information"
					>
						<Info className="h-4 w-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent className="max-w-75">
					<p className="text-sm">{content}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
