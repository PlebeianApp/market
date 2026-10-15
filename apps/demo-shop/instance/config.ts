/**
 * instance/config.ts — **this instance's** runtime configuration.
 *
 * Per ADR-0021 ("Configuration ownership") the SDK owns contracts and the host
 * owns actual per-instance values. This file is the host's own values: the
 * instance identity, the display currency, and the relay set the instance reads
 * from. It carries **no secrets** — ADR-0021 forbids private keys, wallet seeds
 * and tokens in public config or client bundles, and this module is bundled into
 * the browser.
 *
 * `relayUrls` defaults to empty: the demo instance must boot and render with no
 * network at all (ADR-0005), so its product edge is the injected fixture source
 * unless an operator names relays through the environment.
 */

export interface DemoShopInstanceConfig {
	/** Stable instance identity. Scopes caches and publishing targets (ADR-0021, "Instance isolation"). */
	readonly instanceId: string
	/** Human name, rendered in the page header. */
	readonly displayName: string
	/** Display currency for prices that carry no currency of their own. */
	readonly displayCurrency: string
	/** Relays this instance reads product listings from. Empty means "no live read". */
	readonly relayUrls: readonly string[]
}

/**
 * Resolve the instance's public configuration.
 *
 * `env` is injected so the resolution is a pure function of its inputs and a
 * test can drive every branch without touching `process.env` or the network.
 */
export function resolveInstanceConfig(env: Record<string, string | undefined> = {}): DemoShopInstanceConfig {
	const relayUrls = (env.DEMO_SHOP_RELAYS ?? '')
		.split(',')
		.map((url) => url.trim())
		.filter((url) => url.length > 0)

	return {
		instanceId: env.DEMO_SHOP_INSTANCE_ID?.trim() || 'demo-shop',
		displayName: env.DEMO_SHOP_NAME?.trim() || 'Demo Shop',
		displayCurrency: env.DEMO_SHOP_CURRENCY?.trim() || 'SATS',
		relayUrls,
	}
}