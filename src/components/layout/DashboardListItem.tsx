import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronLeftIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import { WalletIcon } from 'lucide-react'

interface DashboardListItemProps extends React.HTMLAttributes<HTMLDivElement> {
	isOpen: boolean
	onOpenChange: (isOpen: boolean) => void
	triggerContent: React.ReactNode
	actions?: React.ReactNode
	children: React.ReactNode
	isCollapsible?: boolean
	isDeleting?: boolean
	icon?: React.ReactNode
	useCloseIcon?: boolean
}

const DashboardListItem = React.forwardRef<HTMLDivElement, DashboardListItemProps>(
	(
		{ isOpen, onOpenChange, triggerContent, children, className, actions, isCollapsible = true, isDeleting, icon, useCloseIcon, ...props },
		ref,
	) => {
		const content = (
			<CollapsibleContent>
				<div className="p-4 pt-0 bg-layer-overlay rounded-b-lg border-t border-layer-medium">{children}</div>
			</CollapsibleContent>
		)

		if (!isCollapsible) {
			return (
				<div ref={ref} className={cn('p-4 border border-black rounded-md fg-layer-elevated', className)} {...props}>
					{children}
				</div>
			)
		}

		return (
			<Collapsible open={isOpen} onOpenChange={onOpenChange} className="space-y-2">
				<Card
					ref={ref}
					className={cn('fg-layer-elevated border border-black', isDeleting && 'opacity-50 pointer-events-none', className)}
					{...props}
				>
					<CollapsibleTrigger asChild>
						<div className="p-4 flex flex-row items-center justify-between cursor-pointer group rounded-lg hover:bg-layer-overlay transition-colors">
							<div className="flex items-center gap-4">
								<div className="flex items-center justify-center w-10 h-10 border-2 border-black fg-layer-overlay rounded-full shadow-md">
									{icon ?? <WalletIcon className="h-5 w-5 text-black" />}
								</div>
								<div className="min-w-0 flex-1">{triggerContent}</div>
							</div>
							<div className="flex items-center gap-2">
								{actions}
								{useCloseIcon ? (
									isOpen ? (
										<XIcon className="h-5 w-5 shrink-0 transition-transform duration-200 text-muted-foreground" />
									) : (
										<ChevronLeftIcon className="h-5 w-5 shrink-0 transition-transform duration-200 text-muted-foreground rotate-0" />
									)
								) : (
									<ChevronLeftIcon
										className={`h-5 w-5 shrink-0 transition-transform duration-200 text-muted-foreground ${
											isOpen ? '-rotate-90' : 'rotate-0'
										}`}
									/>
								)}
							</div>
						</div>
					</CollapsibleTrigger>
					{content}
				</Card>
			</Collapsible>
		)
	},
)

DashboardListItem.displayName = 'DashboardListItem'

export { DashboardListItem }
