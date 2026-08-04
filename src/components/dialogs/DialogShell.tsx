import * as React from 'react'

import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface DialogShellProps {
	/** Controls the dialog open state. */
	open?: boolean
	/** Callback when open state changes. */
	onOpenChange?: (open: boolean) => void
	/** Dialog title. */
	title?: string
	/** Dialog description shown below the title. */
	description?: string
	/** Dialog trigger element. */
	trigger?: React.ReactNode
	/** Footer content (action buttons, etc.). */
	footer?: React.ReactNode
	/** Additional className for the DialogContent. */
	className?: string
	/** Children rendered in the dialog body. */
	children?: React.ReactNode
	/** Show close button. Defaults to true. */
	showClose?: boolean
}

/**
 * DialogShell — a standardized dialog wrapper that ensures consistent surface
 * colors across all dialogs.
 *
 * Currently, dialogs throughout the app hardcode `bg-white` on
 * `DialogContent`, which is a dark-mode bug (assumes light mode). DialogShell
 * uses `bg-background` (a semantic token) instead, which resolves correctly
 * in both light and dark themes.
 *
 * Because `DialogContent` portals to `document.body`, we add the `theme-new`
 * class directly to the portaled content so scoped tokens (including dark
 * mode overrides) still apply even though the content is outside the
 * `ThemeMigrationWrapper` DOM subtree.
 *
 * This component demonstrates the `dialogs/` pattern:
 * - Standardizes dialog surface colors via semantic tokens
 * - Composes Shadcn `ui/dialog` primitives
 * - Accepts title, description, trigger, footer, and body via props
 *
 * The actual migration of existing dialogs (ShareDialog, ShareProductDialog,
 * BugReportModal, etc.) to use DialogShell happens in a later slice.
 */
function DialogShell({ open, onOpenChange, title, description, trigger, footer, className, children, showClose = true }: DialogShellProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent className={cn('theme-new bg-background', className)} showCloseButton={showClose}>
				{(title || description) && (
					<DialogHeader>
						{title && <DialogTitle>{title}</DialogTitle>}
						{description && <DialogDescription>{description}</DialogDescription>}
					</DialogHeader>
				)}
				{children}
				{footer && <DialogFooter>{footer}</DialogFooter>}
			</DialogContent>
		</Dialog>
	)
}

DialogShell.displayName = 'DialogShell'

export { DialogShell, DialogClose }