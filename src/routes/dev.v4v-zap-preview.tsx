import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { V4VZapSplitEditor } from '@/components/nostr/V4VZapSplitEditor'
import type { V4VSplitRow } from '@/lib/v4v/splitAnnouncement'

/**
 * Development-only surface for the V4V zap split editor.
 *
 * It exists because the editor's eventual home — the auction publish flow — is not wiring it yet, and
 * the feature gate (`AGENTS.md` → Feature Quality Gate) requires a runnable, screenshottable surface for
 * the spec. It holds **no logic**: it renders `V4VZapSplitEditor` with fixture rows.
 *
 * It is not reachable in a production build, and it must be deleted once the publish flow hosts the
 * editor. Anything that looks like a product decision belongs in the component or the view model, never
 * here.
 */
export const Route = createFileRoute('/dev/v4v-zap-preview')({ component: V4VZapPreviewPage })

const FIXTURES: V4VSplitRow[] = [
	{ id: '1', destination: 'alice@example.com', bps: 2500, name: 'Alice' },
	{ id: '2', destination: 'bob@example.com', bps: 2500, name: 'Bob' },
	{ id: '3', destination: 'carol@example.com', bps: 1000, name: 'Carol' },
]

function V4VZapPreviewPage() {
	const [rows, setRows] = useState<readonly V4VSplitRow[]>(FIXTURES)
	if (import.meta.env.PROD) {
		return (
			<div className="p-6" data-testid="v4v-preview-unavailable">
				This development preview is not available in a production build.
			</div>
		)
	}
	return (
		<div className="mx-auto max-w-3xl space-y-6 p-6">
			<h1 className="text-xl font-semibold">Auction V4V — split editor (development preview)</h1>
			<p className="text-muted-foreground text-sm">Fixture data. The settlement figure stands in for the current bid.</p>
			<div className="rounded-lg border p-4">
				<V4VZapSplitEditor
					rows={rows}
					onChange={setRows}
					settledSats={100_000}
					minimumZapSats={100}
					endpointFacts={{
						'alice@example.com': { answered: true, zapCapable: true },
						'bob@example.com': { answered: true, zapCapable: false },
						'carol@example.com': { answered: false, zapCapable: false },
					}}
				/>
			</div>
		</div>
	)
}
