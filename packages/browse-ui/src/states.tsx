/**
 * The states a surface can be in, and the vocabulary that goes with them.
 *
 * This is the implementation of the browsing spec's §3.4 failure vocabulary, and the two things it
 * fixes are deliberate:
 *
 *   1. **`unavailable` is distinct from `empty`.** A relay outage must never render as "no products
 *      found". The environment already reports failures as values (`ReadResult`), so a surface that
 *      shows "nothing here" for a failure has to ignore that on purpose.
 *   2. **Gating is fail-closed.** `loading` renders no items and says so; it is never a window in
 *      which unfiltered content is visible (browsing spec §3.3.1).
 */
import type { ParseProblem } from '@plebeian/product-event'
import type { ReactNode } from 'react'

export type SurfaceState =
	| { status: 'loading'; what: string }
	| { status: 'unavailable'; what: string; reason: string; detail?: string }
	| { status: 'empty'; what: string }
	| { status: 'ready' }

/**
 * The gate. A surface must be `ready` before it renders items — this is the fail-closed rule, and it
 * is why `status` is not a boolean. `loading` and `unavailable` both render zero items.
 */
export const LoadingState = ({ what }: { what: string }) => (
	<div className="pb-state" role="status" aria-live="polite">
		<span className="pb-state__title">Waiting for {what}…</span>
		<span>Items stay hidden until the checks that can withhold them have loaded.</span>
	</div>
)

export const UnavailableState = ({ what, reason, detail }: { what: string; reason: string; detail?: string }) => (
	<div className="pb-state pb-state--unavailable" role="alert">
		<span className="pb-state__title">{what} could not be loaded</span>
		<span>
			Reason: <code>{reason}</code>
			{detail ? ` — ${detail}` : ''}
		</span>
		<span>This is not an empty result.</span>
	</div>
)

export const EmptyState = ({ what }: { what: string }) => (
	<div className="pb-state">
		<span className="pb-state__title">No {what}</span>
		<span>The relay answered and had nothing to show.</span>
	</div>
)

/** Render whichever state applies, so every surface names its condition the same way. */
export const SurfaceStateView = ({ state, children }: { state: SurfaceState; children: ReactNode }) => {
	switch (state.status) {
		case 'loading':
			return <LoadingState what={state.what} />
		case 'unavailable':
			return <UnavailableState what={state.what} reason={state.reason} detail={state.detail} />
		case 'empty':
			return <EmptyState what={state.what} />
		case 'ready':
			return <>{children}</>
	}
}

/**
 * What we could not read from an otherwise-valid item.
 *
 * The point of showing these is honesty: the listing resolved, and this says which parts of it did
 * not, rather than quietly rendering a listing that is missing something.
 */
export const ProblemList = ({ problems }: { problems: readonly ParseProblem[] }) => {
	if (problems.length === 0) return null
	return (
		<ul className="pb-problems">
			{problems.map((problem, index) => (
				<li key={`${problem.code}-${problem.field ?? index}`}>
					{problem.field ? `${problem.field}: ` : ''}
					{problem.message}
				</li>
			))}
		</ul>
	)
}

/** The NSFW badge. Mandatory wherever an NSFW item is shown (browsing spec §3.3.1). */
export const NSFWBadge = () => <span className="pb-badge pb-badge--nsfw">NSFW</span>

export const StockBadge = ({ inStock, preorder }: { inStock: boolean; preorder: boolean }) => {
	if (preorder) return <span className="pb-badge pb-badge--preorder">Pre-order</span>
	if (!inStock) return <span className="pb-badge pb-badge--out-of-stock">Out of stock</span>
	return null
}
