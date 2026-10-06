import { cn } from '@/lib/utils'

interface RelayLoadingBarProps extends React.ComponentProps<'div'> {
	/** Whether products are still arriving. When false nothing is rendered. */
	active: boolean
	/** Optional short caption shown above the track. */
	label?: string
}

/**
 * Indeterminate "products are still arriving from relays" bar.
 *
 * A short dash crosses a thin track, so it reads as *waiting*, not as a
 * percentage: nobody knows how many products exist until the relays have
 * answered, and a filling bar would claim a progress that cannot be measured.
 * The track is 2px tall and takes no vertical space beyond that, so products
 * appearing underneath it do not shift.
 *
 * Presentational only (src/components/shared/AGENTS.md): state comes in as
 * props, refs go to the root element.
 */
export function RelayLoadingBar({ active, label, className, ref, ...props }: RelayLoadingBarProps) {
	if (!active) return null

	return (
		<div ref={ref} className={cn('w-full', className)} role="status" aria-live="polite" {...props}>
			{label ? <span className="block pb-1 text-center text-xs text-muted-foreground">{label}</span> : null}
			<div className="relative h-0.5 w-full overflow-hidden rounded-full bg-border">
				<div className="animate-relay-dash h-full w-1/3 rounded-full bg-muted-foreground" />
			</div>
		</div>
	)
}
