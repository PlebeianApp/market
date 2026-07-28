import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * StatusBadge — a wrapper around `ui/badge` that adds semantic UX-state
 * variants (info / warning / error / success) using the scoped `.theme-new`
 * UX-state tokens.
 *
 * This component demonstrates the `ui-wrappers/` pattern:
 * - Wraps a Shadcn primitive (`ui/badge`) with additional variants
 * - Uses `forwardRef` and `cn()` per `src/components/AGENTS.md`
 * - Forwards ref through the primitive's `{...props}` spread
 * - Variants map to scoped semantic tokens, not hardcoded colors
 *
 * Intended for use inside `.theme-new` scope (via `ThemeMigrationWrapper`).
 * The UX-state tokens (`--info`, `--warning`, etc.) are only defined under
 * `.theme-new`, so these variants resolve to actual colors only within that
 * scope. Outside the scope, they fall back to the badge's default styling.
 *
 * @see docs/adr/ADR-component-ui-migration-and-widget-book.md §1a (UX-state tokens)
 */
const statusBadgeVariants = cva('', {
	variants: {
		variant: {
			info: 'bg-info-muted text-info border-info-border',
			warning: 'bg-warning-muted text-warning border-warning-border',
			error: 'bg-error-muted text-error border-error-border',
			success: 'bg-success-muted text-success border-success-border',
			/** Solid variants — filled background with contrasting foreground */
			infoSolid: 'bg-info text-info-foreground border-transparent',
			warningSolid: 'bg-warning text-warning-foreground border-transparent',
			errorSolid: 'bg-error text-error-foreground border-transparent',
			successSolid: 'bg-success text-success-foreground border-transparent',
		},
	},
	defaultVariants: {
		variant: 'info',
	},
})

type StatusBadgeProps = Omit<React.ComponentProps<typeof Badge>, 'variant'> & VariantProps<typeof statusBadgeVariants>

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(({ className, variant = 'info', ...props }, ref) => {
	return (
		<Badge
			ref={ref}
			data-slot="status-badge"
			data-variant={variant}
			className={cn(statusBadgeVariants({ variant }), className)}
			{...props}
		/>
	)
})

StatusBadge.displayName = 'StatusBadge'

export { StatusBadge, statusBadgeVariants, type StatusBadgeProps }
