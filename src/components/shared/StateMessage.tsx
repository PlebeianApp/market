import * as React from 'react'
import { Loader2, AlertCircle, Inbox } from 'lucide-react'

import { cn } from '@/lib/utils'

type StateMessageProps = React.HTMLAttributes<HTMLDivElement> & {
	/** Title text shown prominently (h1). */
	title?: string
	/** Description text shown below the title. */
	description?: string
	/** Optional icon element. Defaults to component-appropriate icon. */
	icon?: React.ReactNode
	/** Action elements (buttons, links) rendered below the description. */
	action?: React.ReactNode
}

/**
 * StateMessage — a full-height centered state display for loading, error,
 * empty, and not-found states.
 *
 * This component is purely presentational: no data hooks, no store access,
 * no business logic. All content is passed via props.
 *
 * Demonstrates the `shared/` pattern:
 * - `forwardRef` to root DOM element
 * - `cn()` className merging
 * - Callback-free presentation
 * - Semantic tokens (`text-muted-foreground`) instead of hardcoded colors
 */
const StateMessage = React.forwardRef<HTMLDivElement, StateMessageProps>(
	({ title, description, icon, action, className, children, ...props }, ref) => {
		return (
			<div ref={ref} className={cn('flex flex-col items-center justify-center gap-4 py-20 text-center', className)} {...props}>
				{icon && <div className="text-muted-foreground">{icon}</div>}
				{title && <h1 className="font-bold text-2xl text-foreground">{title}</h1>}
				{description && <p className="text-muted-foreground max-w-md">{description}</p>}
				{action && <div className="flex gap-2">{action}</div>}
				{children}
			</div>
		)
	},
)

StateMessage.displayName = 'StateMessage'

/**
 * LoadingState — a loading spinner state display.
 */
const LoadingState = React.forwardRef<HTMLDivElement, Omit<StateMessageProps, 'icon'>>(
	({ title = 'Loading...', description, action, className, ...props }, ref) => {
		return (
			<StateMessage
				ref={ref}
				title={title}
				description={description}
				action={action}
				icon={<Loader2 className="size-8 animate-spin" />}
				className={className}
				{...props}
			/>
		)
	},
)

LoadingState.displayName = 'LoadingState'

/**
 * ErrorState — an error state display with an alert icon.
 */
const ErrorState = React.forwardRef<HTMLDivElement, Omit<StateMessageProps, 'icon'> & { error?: unknown }>(
	({ title = 'Something went wrong', description, action, error, className, ...props }, ref) => {
		const desc = description ?? (error instanceof Error ? error.message : undefined)
		return (
			<StateMessage
				ref={ref}
				title={title}
				description={desc}
				action={action}
				icon={<AlertCircle className="size-8" />}
				className={className}
				{...props}
			/>
		)
	},
)

ErrorState.displayName = 'ErrorState'

/**
 * EmptyState — an empty/no-data state display.
 */
const EmptyState = React.forwardRef<HTMLDivElement, Omit<StateMessageProps, 'icon'>>(
	({ title = 'Nothing here yet', description, action, className, ...props }, ref) => {
		return (
			<StateMessage
				ref={ref}
				title={title}
				description={description}
				action={action}
				icon={<Inbox className="size-8" />}
				className={className}
				{...props}
			/>
		)
	},
)

EmptyState.displayName = 'EmptyState'

export { StateMessage, LoadingState, ErrorState, EmptyState, type StateMessageProps }
