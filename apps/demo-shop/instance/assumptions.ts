/**
 * instance/assumptions.ts — **the assumptions the running instance is operating
 * under, as one value, each naming what would falsify it.**
 *
 * The maintainer's instruction, verbatim: *"ensure anyways to document any
 * assumptions you are making and surface them in the app."* Two obligations, and
 * this module is the app's half of both. It **composes** the register; `App.tsx`
 * renders it into the page's footer region, so it is **on the page and in the
 * served HTML** — a bare `curl` shows it, and it is not a comment and not applied
 * after hydration.
 *
 * ## Where each entry comes from
 *
 * 1. **The registers the SDK modules already export as values.** Two modules were
 *    written to hand their assumptions to a host:
 *    `CURRENCY_ASSUMPTIONS` (`sdk/commerce/currency/assumptions.ts`) and
 *    `SHIPPING_READ_ASSUMPTIONS` (`sdk/commerce/shipping/shippingRead.ts`). They
 *    are **imported here, never copied**, so a module's own register and what this
 *    page says about that module cannot drift apart.
 *
 *    They are imported **from their own files rather than from their barrels**,
 *    deliberately: the currency barrel re-exports `./nostrTransport`, which imports
 *    `@modelcontextprotocol/sdk` and `@contextvm/sdk`. The register is data about
 *    an assumption, and data about a dependency should not drag the dependency
 *    into the module graph that reads it.
 *
 * 2. **The app's own assumptions.** Six of them, and the app is the one making
 *    each, so no SDK module can state them on its behalf: the edge these listings
 *    came from, the fact that no live relay read has ever been made, why the
 *    catalog is authored in `BTC`, the refusal of an unlabelled price, the
 *    oracle-sourced rate as a dependency, and the shipping amount the cart's total
 *    deliberately does not include. `source` names the file each is *leaned on*
 *    by, so an entry can be traced from the page back to the code that assumes it.
 *
 * ## Why every entry carries a falsifier
 *
 * `falsifiedBy` is the observation that would show the statement false — a
 * measurement, not "this might be wrong". A register without falsifiers is a
 * disclaimer, and a disclaimer cannot be checked; `instance/assumptions.test.ts`
 * refuses an entry with an empty one, refuses two entries sharing an `id`, and
 * pins the required entries by id so one cannot be dropped silently.
 *
 * ## The numbers in the entries are derived, not typed
 *
 * The mispricing factor quoted for an unlabelled price is computed from the
 * precisions the money rule declares (`sdk/commerce/cart/money.ts`: `BTC` 8,
 * `SAT` 0), and the notation claim is checked against the SDK's own normaliser at
 * boot. A figure typed into prose is a figure nothing re-checks.
 */

import { CART_CURRENCY_PRECISION } from '@sdk/commerce/cart'
import { CURRENCY_ASSUMPTIONS } from '@sdk/commerce/currency/assumptions'
import { ORDER_PLACEMENT_ASSUMPTIONS } from '@sdk/commerce/orders/orderPlacement'
import { BITCOIN_CURRENCY, normalizeCurrency } from '@sdk/commerce/products'
import { SHIPPING_READ_ASSUMPTIONS } from '@sdk/commerce/shipping/shippingRead'

/** The file the SDK's currency register is declared in. The module's own address, not a copy of it. */
export const CURRENCY_REGISTER_SOURCE = 'sdk/commerce/currency/assumptions.ts'

/** The file the SDK's shipping read register is declared in. */
export const SHIPPING_REGISTER_SOURCE = 'sdk/commerce/shipping/shippingRead.ts'

/** The file the SDK's order-placement register is declared in. */
export const ORDER_PLACEMENT_REGISTER_SOURCE = 'sdk/commerce/orders/orderPlacement.ts'

/** The app's own address, for the entries the app is the one assuming. */
export const APP_SOURCE = 'apps/demo-shop/instance/assumptions.ts'

/** One assumption: what is taken for granted, and what would prove it wrong. */
export interface AssumptionEntry {
	/** Stable identity, unique within the register. Cited by `assumptions.test.ts`. */
	readonly id: string
	/** The file that *leans on* this assumption — where to look when it is falsified. */
	readonly source: string
	/** The assumption, in one sentence, as a claim about the world. */
	readonly statement: string
	/** The observation that would make the statement false. Not "it might be wrong" — the measurement. */
	readonly falsifiedBy: string
}

/** The register, and how it counts itself. */
export interface AssumptionRegister {
	readonly entries: readonly AssumptionEntry[]
	/** One line the page renders above the list: how many, and from how many places. */
	readonly summaryLine: string
	/** Per-source counts, so a source that loses all its entries is visible. */
	readonly bySource: readonly { readonly source: string; readonly count: number }[]
}

/**
 * The facts about the running instance the register is built from.
 *
 * Injected rather than read from `process.env` here, so the register is a pure
 * function of its inputs and the fixture arm (a run with relays configured) is
 * testable without a server.
 */
export interface RegisterInput {
	/** The edge this instance actually took. The register must not claim the other one. */
	readonly sourceKind: 'fixture' | 'relay'
	/** The relay addresses this instance was configured with. Empty means "no live read is reachable". */
	readonly relayUrls: readonly string[]
	/** The currency this instance falls back to for a price that carries none. */
	readonly displayCurrency: string
}

/** The declaration `sdk/commerce/cart/money.ts` makes for a currency, or `null` when it declares none. */
function declaredPrecision(currency: string): number | null {
	const precision = CART_CURRENCY_PRECISION[currency]
	return typeof precision === 'number' ? precision : null
}

/**
 * How far reading a `BTC` numeral as a satoshi count shifts it.
 *
 * Derived from the two precisions the money rule declares rather than typed: an
 * amount's meaning is its unit, and the two Bitcoin units sit
 * `BTC_PRECISION - SAT_PRECISION` decimal places apart. `1` when either precision
 * is undeclared — the register then says nothing it cannot support.
 */
export function bitcoinVersusSatsShift(): number {
	const btc = declaredPrecision('BTC')
	const sat = declaredPrecision(BITCOIN_CURRENCY)
	if (btc === null || sat === null) return 1
	return 10 ** (btc - sat)
}

/** The amount the catalog writes for the coat (`instance/catalog.ts`), used as the worked example. */
const EXAMPLE_BTC_AMOUNT = '0.00185'

/**
 * What a `BTC`-tagged numeral is worth in satoshis — computed from the declared
 * `BTC` precision, so the worked example cannot disagree with the money rule it
 * quotes. `null` when that precision is not declared, and the entry then says less.
 */
export function btcNumeralInSats(amount: string): string | null {
	const btc = declaredPrecision('BTC')
	if (btc === null) return null
	const sats = Number(amount) * 10 ** btc
	return Number.isFinite(sats) ? sats.toLocaleString('en-US') : null
}

/** The same numeral, in both units — the worked example the unlabelled-price entry quotes. */
export const UNLABELLED_PRICE_EXAMPLE = Object.freeze({
	/** A price tag exactly as this instance's catalog writes it (`instance/catalog.ts`, the coat). */
	amount: EXAMPLE_BTC_AMOUNT,
	/** The same digits, read with the unit the tag carries. */
	readAsTagged: `${btcNumeralInSats(EXAMPLE_BTC_AMOUNT) ?? 'a whole number of'} satoshis (${EXAMPLE_BTC_AMOUNT} BTC)`,
	/** The same digits, read as a satoshi count — the default this instance refuses. */
	readAsSats: `${EXAMPLE_BTC_AMOUNT} satoshis`,
})

/** The SDK's own answer to "is a price with no currency a price?". Read, not restated. */
const MISSING_CURRENCY_PROBE = normalizeCurrency('')

/** How `normalizeCurrency` spelled that refusal, as the page quotes it. */
export const MISSING_CURRENCY_REFUSAL = MISSING_CURRENCY_PROBE.ok ? 'accepted' : MISSING_CURRENCY_PROBE.reason

/** Thousands-grouped, so a factor of a hundred million reads as one on the page. */
function grouped(value: number): string {
	return value.toLocaleString('en-US')
}

/**
 * The assumptions the **app** is the one making.
 *
 * Six, and each is a claim this instance could be shown wrong about: the edge the
 * listings came from, the absence of any live relay read, the notation the catalog
 * is authored in, the refusal of an unlabelled price, the oracle-sourced rate as a
 * dependency rather than a fact, and the shipping amount left out of the cart's
 * total.
 */
export function appAssumptions(input: RegisterInput): readonly AssumptionEntry[] {
	const relays = input.relayUrls.length
	const edgeStatement =
		input.sourceKind === 'fixture'
			? `The listings on this page are an injected fixture, not a live relay read: instance/catalog.ts builds the kind-30402 events in process, and this instance was configured with ${relays} relay address${relays === 1 ? '' : 'es'}.`
			: `The listings on this page came from a live relay read this instance performed at boot against ${input.relayUrls.join(', ')}, not from the injected fixture.`
	const noLiveReadStatement =
		input.sourceKind === 'fixture'
			? 'No live relay read has ever been performed by this demo: every run has taken the injected fixture edge, and this run is one of them.'
			: 'This run performed a live relay read for the first time: every earlier reading of these listings came from the injected fixture.'

	return [
		{
			id: 'app-listing-edge',
			source: 'apps/demo-shop/instance/boot.ts (resolveProductSource)',
			statement: edgeStatement,
			falsifiedBy: `A page whose edge line names the other edge than this register does — a row that came from a relay while this instance reports "fixture", or the reverse. The line is rendered from the same read as this entry.`,
		},
		{
			id: 'app-no-live-relay-read-performed',
			source: 'apps/demo-shop/instance/server.tsx (the edge line, and /health)',
			statement: noLiveReadStatement,
			falsifiedBy: `A /health response reporting sourceKind "relay", or a page whose edge line reads "relay read via sdk/core/nostr-io", while this register still says the fixture edge. A stored log of an earlier live read is the same falsifier.`,
		},
		{
			id: 'app-catalog-authored-in-btc',
			source: 'apps/demo-shop/instance/catalog.ts',
			statement: `These listings are authored in BTC because the repository's kind-30402 parser admits only a three-letter currency: the SDK's satoshi notation is the three-letter ${BITCOIN_CURRENCY}, while the four-letter spelling SATS that production listings also carry cannot match src/lib/schemas/common.ts's /^[A-Z]{3}$/ rule, so a SATS-tagged listing is refused by this instance's own admission step before it can become a row.`,
			falsifiedBy:
				'A price tag on this page whose currency element is four letters, or a listing authored in the SDK\'s satoshi notation that reaches a row. Either would be a tag the parser refuses, so the row would not exist.',
		},
		{
			id: 'app-unlabelled-price-is-refused',
			source: 'apps/demo-shop/instance/productListView.ts (resolveProductPrice)',
			statement: `An unlabelled price is refused, never defaulted to ${BITCOIN_CURRENCY}: every price on this page is rendered as "<amount> <currency>" from the listing's own price tag, the SDK's own normaliser refuses a price with no currency by name (probe at boot: normalizeCurrency('') → "${MISSING_CURRENCY_REFUSAL}"), and this instance's configured fallback is "${input.displayCurrency}" — which is named on the price only where the listing named it first.`,
			falsifiedBy: `Defaulting is not a rounding error, it is a change of unit: measured on this instance's own numbers, ${UNLABELLED_PRICE_EXAMPLE.amount} tagged BTC is ${UNLABELLED_PRICE_EXAMPLE.readAsTagged} and the same numeral read as a satoshi count is ${UNLABELLED_PRICE_EXAMPLE.readAsSats} — a factor of ${grouped(bitcoinVersusSatsShift())}, i.e. the price is wrong by orders of magnitude for the same digits. A price rendered with a currency its own tag does not carry, or a row that renders without a price where the tag carried one, would falsify this.`,
		},
		{
			id: 'app-cvm-rate-is-a-dependency',
			source: 'sdk/commerce/currency (endpoint injected by a host)',
			statement:
				'The fiat→sats rate this programme charges by is a dependency on the injected ContextVM oracle, not a fact about the world: sdk/commerce/currency is merged into this line and takes its endpoint as configuration, and no surface on this page converts a fiat price — so no rate appears in the served bytes, and none was invented to make one appear.',
			falsifiedBy:
				'A satoshi count on this page derived from a fiat price that no oracle answered — or a rate in the served bytes that came from a constant, a default endpoint or a localhost fallback rather than from the injected endpoint.',
		},
		{
			id: 'app-cart-total-excludes-shipping',
			source: 'apps/demo-shop/instance/cartTotals.ts',
			statement:
				"The cart's total excludes shipping: the commerce read model hands a listing's shipping_option tag as [ref, amount] and declares no unit for the amount, so this instance adds no shipping figure to any sats total and says so rather than inventing a currency for it.",
			falsifiedBy:
				'A shipping figure folded into a sats total, or a shipping cost on the page whose unit came from anywhere but its own kind-30406 price tag\'s third element — the unit sdk/commerce/shipping/shippingRead.ts now carries.',
		},
	]
}

/**
 * The SDK's currency register, re-addressed as entries.
 *
 * Nothing is rewritten: the statement and the falsifier are the module's own
 * strings, and `source` is the file they are declared in.
 */
export function currencyAssumptions(): readonly AssumptionEntry[] {
	return CURRENCY_ASSUMPTIONS.map((assumption) => ({
		id: `currency-${assumption.id}`,
		source: CURRENCY_REGISTER_SOURCE,
		statement: assumption.statement,
		falsifiedBy: assumption.falsifiedBy,
	}))
}

/**
 * The SDK's shipping-read register, re-addressed as entries.
 *
 * `SHIPPING_READ_ASSUMPTIONS` carries no `id` of its own, so an id is composed
 * from the source and the entry's position in that register — stable while the
 * register's order is, and never colliding with a currency id.
 */
export function shippingAssumptions(): readonly AssumptionEntry[] {
	return SHIPPING_READ_ASSUMPTIONS.map((assumption, index) => ({
		id: `shipping-read-${index + 1}`,
		source: SHIPPING_REGISTER_SOURCE,
		statement: assumption.assumption,
		falsifiedBy: assumption.falsifiedBy,
	}))
}

/**
 * The SDK's **order-placement** register, re-addressed as entries.
 *
 * `ORDER_PLACEMENT_ASSUMPTIONS` (`sdk/commerce/orders/orderPlacement.ts`) is the register
 * the step this increment wires landed with — the judgements a cart→order placement makes
 * so that it can answer at all, each with the observation that would falsify it. It is
 * **imported, never copied**: the module's own string is what the page renders.
 *
 * Its entries carry no `id`, so ids are composed from the source and the position in the
 * register, as the shipping read's are. `ORDER_MESSAGING_ASSUMPTIONS` — the sibling
 * register for the messaging step — is **not present in this base** (the messaging modules
 * here export no assumption register), so nothing is claimed for it on the page; when it
 * lands, it joins this list the same way and no sentence here has to change.
 */
export function orderPlacementAssumptions(): readonly AssumptionEntry[] {
	return ORDER_PLACEMENT_ASSUMPTIONS.map((assumption, index) => ({
		id: `order-placement-${index + 1}`,
		source: ORDER_PLACEMENT_REGISTER_SOURCE,
		statement: assumption.assumption,
		falsifiedBy: assumption.falsifiedBy,
	}))
}

/** The sources in the order the register lists them. */
function sourcesOf(entries: readonly AssumptionEntry[]): { source: string; count: number }[] {
	const counts = new Map<string, number>()
	for (const entry of entries) counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1)
	return [...counts.entries()].map(([source, count]) => ({ source, count }))
}

/**
 * Build the register for a running instance.
 *
 * The app's own entries come first — they are the ones this instance is making —
 * and the SDK registers follow, in the order the modules declare them. Every entry
 * is present on every page: the register is a property of the instance, not of a
 * route.
 */
export function buildAssumptionRegister(input: RegisterInput): AssumptionRegister {
	const entries = Object.freeze([
		...appAssumptions(input),
		...currencyAssumptions(),
		...shippingAssumptions(),
		...orderPlacementAssumptions(),
	])
	const bySource = sourcesOf(entries)

	return {
		entries,
		summaryLine: `${entries.length} assumptions this instance is operating under, from ${
			bySource.length
		} place${bySource.length === 1 ? '' : 's'} — each with what would falsify it`,
		bySource,
	}
}
