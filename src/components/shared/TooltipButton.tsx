import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ButtonProps } from './ButtonProps'

interface TooltipButtonProps extends ButtonProps {
	/** Tooltip text shown when button is enabled */
	tooltip?: string
	/** Tooltip text shown when button is disabled */
	disabledTooltip?: string
}

const TooltipButton = React.forwardRef<HTMLButtonElement, TooltipButtonProps>(
	({ tooltip, disabledTooltip, disabled, children, ...props }, ref) => {
		const hasTooltip = Boolean(tooltip || disabledTooltip)

		// If no tooltip is needed, render Button directly
		if (!hasTooltip) {
			return (
				<Button ref={ref} disabled={disabled} {...props}>
					{children}
				</Button>
			)
		}

		// Determine which tooltip to show
		const tooltipContent = disabled && disabledTooltip ? disabledTooltip : tooltip

		if (tooltipContent) {
			// If there's a tooltip, wrap Button with Tooltip
			return (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button ref={ref} disabled={disabled} {...props}>
							{children}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{tooltipContent}</TooltipContent>
				</Tooltip>
			)
		}

		// Else, return button without tooltip
		return (
			<Button ref={ref} disabled={disabled} {...props}>
				{children}
			</Button>
		)
	},
)

TooltipButton.displayName = 'TooltipButton'

export { TooltipButton, type TooltipButtonProps }
