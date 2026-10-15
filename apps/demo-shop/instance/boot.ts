/**
 * instance/boot.ts — the instance boot.
 *
 * This is the host's own composition, and it is the whole of it: resolve this
 * instance's config, choose a product edge, read, compose the view. No relay, no
 * socket and no clock is reached for — every one of them is either this
 * instance's configuration or an argument.
 *
 * ADR-0021's direction holds from here: this file imports `sdk/` (the read model
 * and the I/O seam) and `src/` (the kind-30402 parser, transitionally), and
 * nothing under `sdk/` can import it back — `sdk/boundary.test.ts` forbids
 * `@apps/` in a production SDK module.
 */

import { buildCatalogEvents } from './catalog'
import { resolveInstanceConfig, type DemoShopInstanceConfig } from './config'
import { buildProductListView, type ProductListView, type ProductListViewOptions } from './productListView'
import {
	createFixtureProductSource,
	createInstanceNostrIo,
	createRelayProductSource,
	type InjectedPool,
	type ProductSource,
} from './productSource'

export interface InstanceRuntime {
	readonly config: DemoShopInstanceConfig
	/** Which edge produced the data, so the page can say so. */
	readonly sourceKind: ProductSource['kind']
	readonly view: ProductListView
	/** The listing fields the SDK would need to agree on with the read model, kept for the page. */
	readonly loadedAtMs: number
}

/**
 * Choose the product edge.
 *
 * An explicitly injected source always wins; otherwise the instance reads live
 * only when it was configured with relays, and answers from its own catalog when
 * it was not. The branch is a fact about configuration, not a fallback that
 * hides a failure.
 */
export function resolveProductSource(
	config: DemoShopInstanceConfig,
	options: { source?: ProductSource; pool?: InjectedPool; limit?: number; deadlineMs?: number } = {},
): ProductSource {
	if (options.source) return options.source

	if (config.relayUrls.length === 0) return createFixtureProductSource(buildCatalogEvents())

	return createRelayProductSource({
		io: createInstanceNostrIo({ relayUrls: config.relayUrls, ...(options.pool ? { pool: options.pool } : {}) }),
		...(options.limit === undefined ? {} : { limit: options.limit }),
		...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
	})
}

export interface BootInstanceOptions {
	/** Override the instance config outright (used by tests). */
	config?: DemoShopInstanceConfig
	/** Environment the instance config resolves from. */
	env?: Record<string, string | undefined>
	/** The injected edge. When present, no relay is ever composed. */
	source?: ProductSource
	/** Transport for the relay edge, when one is composed. */
	pool?: InjectedPool
	view?: ProductListViewOptions
	/** Injected clock, so a test reads no wall clock. */
	now?: () => number
}

/** Boot the instance: config, edge, read, view. */
export async function bootInstance(options: BootInstanceOptions = {}): Promise<InstanceRuntime> {
	const config = options.config ?? resolveInstanceConfig(options.env ?? {})
	const now = options.now ?? (() => Date.now())
	const source = resolveProductSource(config, { source: options.source, pool: options.pool })

	const events = await source.listProducts()
	const view = buildProductListView(events, options.view)

	return {
		config,
		sourceKind: source.kind,
		view,
		loadedAtMs: now(),
	}
}