/**
 * instance/shippingSource.ts — **the demo instance's kind-30406 edge.**
 *
 * `sdk/commerce/shipping/shippingRead.ts` (R2) is the typed read for a kind-30406
 * shipping option: one untrusted event in, the resolved *service* out, and — the
 * fix it landed — the **unit** of the amount the option charges. This file is the
 * host's half of that pair: it states the demo's own shipping record, and it reads
 * its own corpus back, so the checkout has a `servicesByShippingRef` map that came
 * from a record rather than from the ref's text.
 *
 * ## Why the demo needs a shipping record at all
 *
 * Every listing in `instance/catalog.ts` publishes one `shipping_option` tag naming
 * `30406:<seller>:standard`, and *nothing in the served data was that event*: the
 * read model hands over the ref, `resolveCheckoutDeliveryRequirements` resolves the
 * ref's **service** from a map the host supplies, and a host with no record can only
 * supply an empty map — which is why, until now, every chosen shipping ref resolved
 * as unresolved and no cart could be placed.
 *
 * So the demo states the record, through the SDK's **write** side
 * (`buildShippingOptionEventData`) exactly as `instance/catalog.ts` states its
 * listings through `buildSellerProductEventData`: the tags are the SDK's, and the
 * two fields it deliberately does not invent (`pubkey`, `created_at`) are the
 * host's. The `d` is the option id every listing's ref already names, so the ref a
 * listing publishes and the ref that resolves are **one string** — `DEMO_SHIPPING_REF`
 * in `instance/catalog.ts`, imported here and never re-typed.
 *
 * ## Nothing is inferred from the ref
 *
 * A ref like `30406:…:standard` *looks* like it names its service, and reading it
 * that way is exactly the guess `instance/checkoutView.ts` refuses to make. The only
 * path from a ref to a service here is `readShippingOption` over the record — and
 * where the edge read **no** record (the relay adapter reads listings and only
 * listings), the read is not performed at all: `records: null` is a different
 * statement from `records: []`, and the view says which one it is.
 */

import { getProductShippingOptions, type ProductReadEvent } from '@sdk/commerce/discovery'
import {
	readShippingOptions,
	servicesByShippingRef as mapServicesByRef,
	type ShippingOptionReadEvent,
	type ShippingOptionRecord,
	type ShippingOptionRefusal,
} from '@sdk/commerce/shipping/shippingRead'
import { buildShippingOptionEventData } from '@sdk/commerce/shipping/shippingWorkflow'

import {
	DEMO_SELLER_PUBKEY,
	DEMO_SHIPPING_AMOUNT,
	DEMO_SHIPPING_CURRENCY,
	DEMO_SHIPPING_OPTION_ID,
} from './catalog'

/** The clock the demo's shipping record is stamped with. The host owns it, not the SDK. */
export const DEMO_SHIPPING_CREATED_AT = 1_760_000_700

/**
 * The demo's one kind-30406 record.
 *
 * Its `d` is `DEMO_SHIPPING_OPTION_ID` and its envelope pubkey is the demo seller, so
 * the ref it resolves *under* is the `DEMO_SHIPPING_REF` every listing publishes. The
 * amount is `DEMO_SHIPPING_AMOUNT` in `DEMO_SHIPPING_CURRENCY`, so the listing's tag
 * and the record agree about the figure — and the record is the one that carries the
 * **unit**.
 */
export function buildShippingCatalogEvents(): ShippingOptionReadEvent[] {
	const data = buildShippingOptionEventData(
		{
			title: 'Standard shipping',
			description: 'Posted by the seller within two working days.',
			price: DEMO_SHIPPING_AMOUNT,
			currency: DEMO_SHIPPING_CURRENCY,
			countries: ['FR'],
			service: 'standard',
			carrier: 'Demo Post',
			duration: { min: '3', max: '5', unit: 'D' },
		},
		DEMO_SHIPPING_OPTION_ID,
	)

	return [{ ...data, pubkey: DEMO_SELLER_PUBKEY, created_at: DEMO_SHIPPING_CREATED_AT }]
}

/**
 * One shipping ref a listing publishes, joined to what the kind-30406 read said about
 * it — or to the **constraint** that stopped it resolving.
 *
 * `taggedAmount` is the listing's own `shipping_option` tag amount and `price` is the
 * record's amount **with its unit**. They are separate fields on purpose: a surface can
 * then show the figure the listing tagged and the denomination only the record carries
 * without ever printing one as the other.
 */
export interface ShippingOptionRefView {
	readonly ref: string
	readonly optionId: string
	/** Whether a kind-30406 record resolved this ref to a service. */
	readonly known: boolean
	readonly service: string | null
	readonly title: string | null
	readonly price: { readonly amount: string; readonly unit: string } | null
	/** The amount exactly as the listing's `shipping_option` tag carries it — no unit invented. */
	readonly taggedAmount: string | null
	/** The read's own constraint id, when the record did not resolve the ref. */
	readonly refusal: string | null
	/** The refusing record's own message, when there was one. */
	readonly refusalMessage: string | null
}

/** The shipping edge, as the page and the checkout read it. */
export interface ShippingReadView {
	/** Which records this edge read — named, so a run cannot claim the other. */
	readonly edge: 'fixture-catalog' | 'not-read-on-this-edge'
	/** The map `resolveCheckoutDeliveryRequirements` resolves a chosen ref against. */
	readonly servicesByShippingRef: Readonly<Record<string, string>>
	/** Every shipping ref the listings publish, per seller, joined to the read. */
	readonly optionsBySeller: Readonly<Record<string, readonly ShippingOptionRefView[]>>
	/** The read's refusals, carried rather than swallowed ("no silent disappearance"). */
	readonly refusals: readonly ShippingOptionRefusal[]
	readonly summaryLine: string
}

/** The option id in a `30406:<seller>:<d>` ref, or `null` when the ref is not that shape. */
export function shippingOptionIdOf(ref: string): string | null {
	const parts = ref.split(':')
	if (parts.length < 3 || parts[0] !== '30406') return null
	const id = parts.slice(2).join(':')
	return id.length > 0 ? id : null
}

/** The seller segment of a `30406:<seller>:<d>` ref, or `null` when the ref is not that shape. */
export function shippingRefSellerOf(ref: string): string | null {
	const parts = ref.split(':')
	if (parts.length < 3 || parts[0] !== '30406') return null
	return parts[1] && parts[1].length > 0 ? parts[1] : null
}

/**
 * Read the shipping edge.
 *
 * `records` is the corpus this edge read — `buildShippingCatalogEvents()` on the fixture
 * edge, `null` where the edge composes none. `null` is not an empty corpus: it means the
 * read was **not performed**, which is a different sentence on the page and a different
 * value on `edge`.
 */
export function buildShippingRead(
	productEvents: readonly ProductReadEvent[],
	options: { records?: readonly ShippingOptionReadEvent[] | null } = {},
): ShippingReadView {
	const records = options.records === undefined ? buildShippingCatalogEvents() : options.records

	const read = records === null ? null : readShippingOptions(records)
	const serviceRecords: readonly ShippingOptionRecord[] = read?.services ?? []
	const refusals: readonly ShippingOptionRefusal[] = read?.refusals ?? []
	const servicesByShippingRef = mapServicesByRef(serviceRecords)

	const recordByRef = new Map<string, ShippingOptionRecord>(
		serviceRecords.map((service) => [service.ref, service] as const),
	)
	const refusalByRef = new Map<string, ShippingOptionRefusal>()
	for (const refusal of refusals) {
		if (refusal.ref && !refusalByRef.has(refusal.ref)) refusalByRef.set(refusal.ref, refusal)
	}

	const byRef = new Map<string, ShippingOptionRefView>()
	for (const event of productEvents) {
		for (const tag of getProductShippingOptions(event)) {
			const ref = tag[1]
			if (!ref || byRef.has(ref)) continue
			const record = recordByRef.get(ref)
			const refusal = refusalByRef.get(ref)
			byRef.set(ref, {
				ref,
				optionId: shippingOptionIdOf(ref) ?? '',
				known: record !== undefined,
				service: record?.service ?? null,
				title: record?.title ?? null,
				price: record ? { amount: record.price.amount, unit: record.price.unit } : null,
				taggedAmount: tag[2] ?? null,
				refusal: refusal?.constraint ?? null,
				refusalMessage: refusal?.message ?? null,
			})
		}
	}

	const perSeller = new Map<string, ShippingOptionRefView[]>()
	for (const option of byRef.values()) {
		const seller = shippingRefSellerOf(option.ref) ?? ''
		const list = perSeller.get(seller) ?? []
		list.push(option)
		perSeller.set(seller, list)
	}

	const optionsBySeller: Record<string, readonly ShippingOptionRefView[]> = {}
	for (const [seller, list] of perSeller) optionsBySeller[seller] = Object.freeze(list)

	const published = byRef.size
	const resolved = [...byRef.values()].filter((option) => option.known).length
	const plural = published === 1 ? '' : 's'
	const summaryLine =
		records === null
			? `this edge read no kind-30406 record, so the ${published} shipping ref${plural} a listing publishes resolve${published === 1 ? 's' : ''} as unresolved`
			: `${resolved} of the ${published} shipping ref${plural} a listing publishes resolved through the kind-30406 read`

	return {
		edge: records === null ? 'not-read-on-this-edge' : 'fixture-catalog',
		servicesByShippingRef,
		optionsBySeller,
		refusals: Object.freeze([...refusals]),
		summaryLine,
	}
}
