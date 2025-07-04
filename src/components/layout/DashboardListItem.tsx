import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronLeftIcon } from 'lucide-react'
import * as React from 'react'

interface DashboardListItemProps extends React.HTMLAttributes<HTMLDivElement> {
	isOpen: boolean
	onOpenChange: (isOpen: boolean) => void
	triggerContent: React.ReactNode
	actions?: React.ReactNode
	children: React.ReactNode
	isCollapsible?: boolean
}

const DashboardListItem = React.forwardRef<HTMLDivElement, DashboardListItemProps>(
	({ isOpen, onOpenChange, triggerContent, children, className, actions, isCollapsible = true, ...props }, ref) => {
		if (!isCollapsible) {
			return (
				<div ref={ref} className={cn('p-4 border rounded-md bg-white', className)} {...props}>
					{children}
				</div>
			)
		}

		return (
			<Collapsible open={isOpen} onOpenChange={onOpenChange}>
				<div ref={ref} className={cn('border rounded-md bg-white', className)} {...props}>
					<CollapsibleTrigger asChild>
						<div className="group flex w-full justify-between items-center gap-2 p-4 cursor-pointer hover:bg-gray-50">
							<div className="flex-1 min-w-0">{triggerContent}</div>
							<div className="flex items-center gap-2">
								{actions}
								<ChevronLeftIcon className="w-4 h-4 transition-transform duration-200 group-data-[state=open]:-rotate-90 shrink-0" />
							</div>
						</div>
					</CollapsibleTrigger>
					<CollapsibleContent>{children}</CollapsibleContent>
				</div>
			</Collapsible>
		)
	},
)

DashboardListItem.displayName = 'DashboardListItem'

export { DashboardListItem }
