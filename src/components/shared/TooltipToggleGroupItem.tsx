import * as React from 'react'
import { ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Helper type to extract "ToggleGroupItemProps" type from shadcn "ToggleGroupItem" component */
export type ToggleGroupItemProps = React.ComponentPropsWithoutRef<typeof ToggleGroupItem>

/** Helper type to use valid string values for ToggleGroupItem Variants */
export type ToggleGroupItemVariant = 'default' | 'outline'

interface TooltipToggleGroupItemProps extends ToggleGroupItemProps {
	/** Tooltip text shown when the item is available */
	tooltip?: string
}

interface TooltipToggleGroupItemProps extends ToggleGroupItemProps {
	/** Tooltip text shown when the item is available */
	tooltip?: string
}

const TooltipToggleGroupItem = React.forwardRef<HTMLButtonElement, TooltipToggleGroupItemProps>(
	({ tooltip, disabled, children, ...props }, ref) => {
		const hasTooltip = Boolean(tooltip)

		// If no tooltip is needed, render ToggleGroupItem directly
		if (!hasTooltip) {
			return (
				<ToggleGroupItem ref={ref} disabled={disabled} {...props}>
					{children}
				</ToggleGroupItem>
			)
		}

		// If there's a tooltip, wrap ToggleGroupItem with Tooltip
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<ToggleGroupItem ref={ref} disabled={disabled} {...props}>
						{children}
					</ToggleGroupItem>
				</TooltipTrigger>
				<TooltipContent side="bottom">{tooltip}</TooltipContent>
			</Tooltip>
		)
	},
)

TooltipToggleGroupItem.displayName = 'TooltipToggleGroupItem'

export { TooltipToggleGroupItem, type TooltipToggleGroupItemProps }
