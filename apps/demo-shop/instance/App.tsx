/**
 * instance/App.tsx — the page.
 *
 * The shell states three things the screenshot must be able to prove on its own:
 * which instance this is, which edge the data came from, and what the list
 * contains. If the rows were empty, the page would say "0 listings" rather than
 * looking like a list that merely failed to load.
 */

import * as React from 'react'

import { ProductList } from './ProductList'
import type { ProductListView } from './productListView'

export interface DemoShopPageProps {
	readonly instanceName: string
	readonly instanceId: string
	readonly sourceKind: 'fixture' | 'relay'
	readonly view: ProductListView
}

export function App({ instanceName, instanceId, sourceKind, view }: DemoShopPageProps) {
	const edgeLine =
		sourceKind === 'fixture'
			? `edge: injected fixture source (no network) · instance ${instanceId}`
			: `edge: relay read via sdk/core/nostr-io · instance ${instanceId}`

	return (
		<div className="ds-page">
			<header className="ds-header">
				<h1 className="ds-instance-name" data-testid="instance-name">
					{instanceName}
				</h1>
				<p className="ds-muted" data-testid="edge-line">
					{edgeLine}
				</p>
			</header>

			<main className="ds-main">
				<ProductList view={view} />
			</main>

			<footer className="ds-footer">
				<p>
					app: <span data-testid="composition-path">apps/demo-shop</span> · composes{' '}
					<span>@sdk/commerce/&#123;products,discovery&#125;</span> and <span>@ui</span>
				</p>
			</footer>
		</div>
	)
}