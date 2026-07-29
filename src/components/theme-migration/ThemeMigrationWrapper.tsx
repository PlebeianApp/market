import { forwardRef, type HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * ThemeMigrationWrapper — opts a subtree into the `.theme-new` token scope.
 *
 * Wrapping a subtree in this component applies the `theme-new` CSS class,
 * which redefines all design tokens (colors, fonts, radii) for that subtree
 * only. This enables slice-by-slice migration: migrated UI uses the new
 * token system while unmigrated UI continues using the legacy `:root` tokens
 * from `globals.css`. Both can coexist on the same page without conflict.
 *
 * Usage:
 *   <ThemeMigrationWrapper>{children}</ThemeMigrationWrapper>
 *
 * The wrapper renders a plain `<div>` with the `theme-new` class. When the
 * entire app is migrated, the wrapper can be moved to the root layout and the
 * legacy `:root` token block removed from `globals.css`.
 *
 * @see docs/adr/ADR-component-ui-migration-and-widget-book.md §1a, §2b
 */
const ThemeMigrationWrapper = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, children, ...props }, ref) => {
	return (
		<div ref={ref} className={cn('theme-new', className)} {...props}>
			{children}
		</div>
	)
})

ThemeMigrationWrapper.displayName = 'ThemeMigrationWrapper'

export { ThemeMigrationWrapper }
