import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface StateMessageProps extends React.ComponentProps<'div'> {
	/** Headline for the state, e.g. "No products found". */
	title: string
	/** Optional supporting sentence under the headline. */
	description?: string
	/** When provided, renders a secondary "Try again" action. */
	onRetry?: () => void
	/** Overrides the retry button label. */
	retryLabel?: string
	/** Extra actions rendered under the headline (e.g. a create button). */
	children?: React.ReactNode
}

/**
 * Centered placeholder for a section that has no content to show yet.
 *
 * One shape for the three states a relay-backed section can be in — still
 * fetching, settled and empty, or failed — so the copy differs but the layout
 * does not, and callers cannot accidentally render "empty" for "not answered
 * yet" by reaching for a bespoke block. Presentational only
 * (src/components/shared/AGENTS.md): state comes in as props, the ref goes to
 * the root element, colours are semantic tokens.
 */
export function StateMessage({
	title,
	description,
	onRetry,
	retryLabel = 'Try again',
	children,
	className,
	ref,
	...props
}: StateMessageProps) {
	return (
		<div ref={ref} className={cn('flex flex-col flex-1 justify-center items-center gap-4', className)} {...props}>
			<span className="font-heading text-2xl text-center">{title}</span>
			{description ? <span className="max-w-md text-center text-sm text-muted-foreground">{description}</span> : null}
			{onRetry ? (
				<Button onClick={onRetry} variant="secondary" className="flex items-center gap-2">
					<RotateCcw className="w-4 h-4" />
					{retryLabel}
				</Button>
			) : null}
			{children}
		</div>
	)
}
