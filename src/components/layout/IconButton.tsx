import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface IconButtonProps extends React.ComponentProps<typeof Button> {
	/** Tooltip text shown on hover. */
	tooltip?: string
	/** Whether the button is in an active/selected state. */
	isActive?: boolean
	/** Optional notification count to display as a badge. */
	notificationCount?: number
}

/**
 * IconButton — a square icon-only button with consistent sizing, an
 * optional notification badge, and an optional tooltip.
 *
 * Extracted from the repeated pattern in `Header.tsx` where `LoginButton`,
 * `LogoutButton`, `ProfileButton`, `CartButton`, `DashboardButton`,
 * `WalletButton`, and `BugReportButton` all share the same
 * `btn-border-highlight w-11 h-10 p-2` shell with a notification badge
 * (`bg-secondary rounded-full w-5 h-5 font-bold text-black text-xs`).
 *
 * This component demonstrates the `layout/` pattern:
 * - Uses `forwardRef`, `cn()`
 * - Tokenized badge colors (`bg-secondary text-secondary-foreground`) instead
 *   of hardcoded `text-black` (which was a dark-mode bug)
 * - Callbacks for actions (the button click behavior is passed via `onClick`)
 * - Renders a Radix tooltip when `tooltip` is provided
 *
 * The `btn-border-highlight` utility remains in the legacy `globals.css` until
 * the Button variant system replaces it in a later migration slice.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
	({ className, isActive, notificationCount, tooltip, children, ...props }, ref) => {
		const button = (
			<Button
				ref={ref}
				variant="outline"
				className={cn('relative btn-border-highlight w-11 h-10 p-2', isActive && 'btn-active', className)}
				aria-label={tooltip}
				{...props}
			>
				{children}
				{!!notificationCount && notificationCount > 0 && (
					<span className="absolute -top-1 -right-1 inline-flex items-center justify-center bg-secondary rounded-full min-w-5 h-5 px-1 font-bold text-secondary-foreground text-xs">
						{notificationCount > 99 ? '99+' : notificationCount}
					</span>
				)}
			</Button>
		)

		if (!tooltip) {
			return button
		}

		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>{button}</TooltipTrigger>
					<TooltipContent>{tooltip}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	},
)

IconButton.displayName = 'IconButton'

export { IconButton }