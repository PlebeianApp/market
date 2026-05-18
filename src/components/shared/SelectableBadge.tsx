import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type BadgeProps = React.ComponentPropsWithoutRef<typeof Badge>

interface SelectableBadgeProps extends BadgeProps {
	/** Whether the badge is currently selected */
	isSelected?: boolean
}

const SelectableBadge = React.forwardRef<HTMLSpanElement, SelectableBadgeProps>(({ isSelected = false, className, ...props }, ref) => {
	// Define the specific styles requested
	const notSelectedStyles =
		'bg-primary border-primary hover:border-primary-border-hover text-primary-foreground-hover active:bg-primary-border-hover'

	const selectedStyles = 'bg-primary border-primary-border-hover text-primary-foreground-hover active:bg-primary-border-hover'

	// Apply selection styles before the incoming className
	const selectionClasses = isSelected ? selectedStyles : notSelectedStyles

	return <Badge ref={ref} data-selected={isSelected} className={cn(selectionClasses, 'py-1.5 px-3 my-1', className)} {...props} />
})

SelectableBadge.displayName = 'SelectableBadge'

export { SelectableBadge }
