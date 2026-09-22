/**
 * The explorer — the first working consumer of the packages, and the honest test of the extraction.
 *
 * It imports **nothing from `src/`**. If this app runs, the packages are real: they validate, they
 * describe queries, they render, and they do it with no knowledge of the marketplace application.
 *
 * Three projections are demonstrated, in the order the architecture defines them:
 *
 *   1. **Live** — the web implementation (`@plebeian/web`) reading real relays.
 *   2. **CMS** — the same components composed from a page definition through component manifests,
 *      with no hand-written per-component code.
 *   3. **Sandbox (stub)** — the same components under the napplet binding, where the environment is a
 *      capability object rather than a network. Labelled a stub: it is not a real sandboxed frame.
 */
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import '../../../packages/contract/src/tokens.css'
import '../../../packages/browse/src/styles.css'

import { createNappletEnvironment, type NappletRuntimeLike } from '@plebeian/napplet'
import { defaultProductFilters, ProductGrid, SurfaceStateView, type ProductFilterState, type SurfaceState } from '@plebeian/browse'
import { parseListing, type ParseProblem, type ProductListing } from '@plebeian/product'
import { CONFIG_KEYS, type ModuleEnvironment, type RawEvent } from '@plebeian/contract'
import { createNostrToolsEnvironment } from '@plebeian/web'

import { findManifest, resolvePageData, type PageDefinition } from './cms'

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']

const PAGE: PageDefinition = {
	title: 'A page built from component manifests',
	blocks: [
		{ component: 'product-grid', args: { title: 'Everything', category: '', showOutOfStock: false } },
		{ component: 'product-grid', args: { title: 'Clothing', category: 'clothing', showOutOfStock: true } },
	],
}

type Mode = 'live' | 'cms' | 'sandbox'

/** Parse a batch of raw events, keeping the problems so the surface can disclose them. */
const parseAll = (events: readonly RawEvent[]): { listings: ProductListing[]; problems: Map<string, ParseProblem[]> } => {
	const listings: ProductListing[] = []
	const problems = new Map<string, ParseProblem[]>()
	for (const raw of events) {
		const result = parseListing(raw)
		if (result.ok) {
			listings.push(result.value)
			if (result.problems.length) problems.set(result.value.coordinate, [...result.problems])
		}
	}
	return { listings, problems }
}

/** Read a feed through the environment, mapping failures to the honest surface state. */
const useFeed = (env: ModuleEnvironment, enabled: boolean) => {
	const [state, setState] = useState<SurfaceState>({ status: 'loading', what: 'the feed' })
	const [listings, setListings] = useState<ProductListing[]>([])
	const [problems, setProblems] = useState<Map<string, ParseProblem[]>>(new Map())
	const [reloadKey, setReloadKey] = useState(0)

	useEffect(() => {
		if (!enabled) return
		let cancelled = false
		setState({ status: 'loading', what: 'the feed' })
		env.nostr
			.read([{ kinds: [30402], limit: 60 }], { timeoutMs: 9000 })
			.then((result) => {
				if (cancelled) return
				if (!result.ok) {
					setState({ status: 'unavailable', what: 'the feed', reason: result.reason, detail: result.detail })
					return
				}
				if (result.empty) {
					setState({ status: 'empty', what: 'listings' })
					return
				}
				const parsed = parseAll(result.events)
				setListings(parsed.listings)
				setProblems(parsed.problems)
				setState({ status: 'ready' })
			})
			.catch((error: unknown) => {
				if (!cancelled) setState({ status: 'unavailable', what: 'the feed', reason: 'transport', detail: String(error) })
			})
		return () => {
			cancelled = true
		}
	}, [env, enabled, reloadKey])

	return { state, listings, problems, reload: () => setReloadKey((key) => key + 1) }
}

const Toolbar = ({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) => (
	<nav className="tabs">
		{(
			[
				['live', 'Live feed'],
				['cms', 'CMS page (manifests)'],
				['sandbox', 'Sandbox binding (stub)'],
			] as const
		).map(([value, label]) => (
			<button key={value} type="button" className={mode === value ? 'tab tab--active' : 'tab'} onClick={() => setMode(value)}>
				{label}
			</button>
		))}
	</nav>
)

const LiveView = () => {
	const env = useMemo(
		() =>
			createNostrToolsEnvironment({
				relays: RELAYS,
				config: { [CONFIG_KEYS.showNSFW]: new URLSearchParams(location.search).get('nsfw') ?? 'false' },
			}),
		[],
	)
	const { state, listings, problems, reload } = useFeed(env, true)
	const [filters, setFilters] = useState<ProductFilterState>(defaultProductFilters)
	const [showNSFW, setShowNSFW] = useState(false)

	return (
		<section>
			<div className="pb-toolbar">
				<label>
					<input
						type="checkbox"
						checked={filters.showOutOfStock}
						onChange={(e) => setFilters({ ...filters, showOutOfStock: e.target.checked })}
					/>{' '}
					show out-of-stock
				</label>
				<label>
					<input
						type="checkbox"
						checked={filters.hidePreorder}
						onChange={(e) => setFilters({ ...filters, hidePreorder: e.target.checked })}
					/>{' '}
					hide pre-orders
				</label>
				<label>
					<input type="checkbox" checked={showNSFW} onChange={(e) => setShowNSFW(e.target.checked)} /> show NSFW
				</label>
				<select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as ProductFilterState['sort'] })}>
					<option value="newest">newest</option>
					<option value="oldest">oldest</option>
					<option value="a-z">a–z</option>
					<option value="z-a">z–a</option>
				</select>
				<button type="button" onClick={reload}>
					reload
				</button>
			</div>
			<ProductGrid listings={listings} env={env} state={state} filters={filters} showNSFW={showNSFW} problemsByCoordinate={problems} />
		</section>
	)
}

const CmsView = () => {
	const env = useMemo(() => createNostrToolsEnvironment({ relays: RELAYS }), [])
	const [resolved, setResolved] = useState<Map<number, ProductListing[]> | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		resolvePageData(PAGE, env, parseListing as never)
			.then(setResolved)
			.catch((e: unknown) => setError(String(e)))
	}, [env])

	return (
		<section>
			<p className="hint">
				This page is a <strong>page definition</strong>. Each block names a component; the renderer reads that component's manifest for its
				arguments and its data requirements, builds the filter itself, and hands the component validated listings. Nothing here knows what a
				product grid is.
			</p>
			<table className="manifest-table">
				<thead>
					<tr>
						<th>block</th>
						<th>declared dependencies</th>
						<th>renderers</th>
						<th>declared arguments</th>
						<th>declared data</th>
					</tr>
				</thead>
				<tbody>
					{PAGE.blocks.map((block, index) => {
						const manifest = findManifest(block.component)
						return (
							<tr key={index}>
								<td>{block.component}</td>
								<td>{manifest?.dependencies.packages.join(', ')}</td>
								<td>{manifest?.dependencies.renderers.join(', ')}</td>
								<td>{Object.keys(manifest?.arguments ?? {}).join(', ')}</td>
								<td>
									kind {manifest?.dataRequirements.kinds.join('/')}, limit {manifest?.dataRequirements.limit}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
			{error ? <p className="pb-state pb-state--unavailable">{error}</p> : null}
			{!resolved ? (
				<SurfaceStateView state={{ status: 'loading', what: 'the page blocks' }}>
					<span />
				</SurfaceStateView>
			) : (
				PAGE.blocks.map((block, index) => (
					<div key={index}>
						<h2>{String(block.args.title ?? block.component)}</h2>
						<ProductGrid
							listings={resolved.get(index) ?? []}
							env={env}
							state={{ status: 'ready' }}
							filters={{ ...defaultProductFilters, showOutOfStock: Boolean(block.args.showOutOfStock) }}
							showNSFW={false}
						/>
					</div>
				))
			)}
		</section>
	)
}

const SandboxView = () => {
	/**
	 * A stub capability object, shaped like the surface a NIP-5D host injects. A real napplet would
	 * receive this from `window.napplet`; here it is in-page so the binding can be exercised.
	 *
	 * The point being demonstrated is narrow and worth stating: the components rendered below are the
	 * same files as the live view, and the only difference is which object was passed as `env`.
	 */
	const runtime = useMemo<NappletRuntimeLike>(
		() => ({
			outbox: {
				query: async () => {
					// Deliberately fail, to show that a sandboxed surface reports the failure rather than "no results".
					throw new Error('shell: query timed out')
				},
			},
			resource: {},
		}),
		[],
	)
	const env = useMemo(() => createNappletEnvironment({ runtime }), [runtime])
	const { state } = useFeed(env, true)

	return (
		<section>
			<p className="hint">
				Same components, bound to a <strong>capability object</strong> instead of a network. The stub deliberately fails, because the
				interesting behaviour is the difference between <em>“the read failed”</em> and <em>“there is nothing to show”</em> — which the
				application currently collapses into an empty list.
			</p>
			<ProductGrid listings={[]} env={env} state={state} filters={defaultProductFilters} showNSFW={false} />
		</section>
	)
}

export const App = () => {
	const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).get('view') as Mode) ?? 'live')

	useEffect(() => {
		const params = new URLSearchParams(location.search)
		params.set('view', mode)
		history.replaceState(null, '', `?${params.toString()}`)
	}, [mode])

	return (
		<main className="plebeian-browse">
			<header className="app-header">
				<h1>Plebeian explorer</h1>
				<p className="hint">
					Built entirely from <code>@plebeian/*</code> packages — no imports from the application.
				</p>
			</header>
			<Toolbar mode={mode} setMode={setMode} />
			{mode === 'live' ? <LiveView /> : null}
			{mode === 'cms' ? <CmsView /> : null}
			{mode === 'sandbox' ? <SandboxView /> : null}
		</main>
	)
}

/** Mount. Guarded so importing this module in a test does not require a DOM. */
const root = document.getElementById('root')
if (root) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
}
