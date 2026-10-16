/**
 * shipping/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `shipping` owns kind 30406 (`shippingWorkflow.ts:1`), cited to the repository's own shipping-option
 * parser. `checks: []` is a declared "demands nothing yet".
 *
 * **The kind now has a typed READ as well as a write side** (`shippingRead.ts`). The read does not add a
 * second definition of valid: it reads the tag grammar the `parser` citation names —
 * `['price', <decimal>, <ISO 4217>]`, the parser's `ShippingPriceTagSchema`, whose **third element is the
 * amount's unit** — and refuses an event that lacks it, naming the constraint (`missing-price-unit`) and
 * the tag, never dropping it silently. What it adds is the value: a `ShippingOptionRecord` whose `price`
 * carries a **required** `unit`, so an amount printed without one is unrepresentable.
 *
 * `checks: []` stays empty on purpose. The read's own constraints (`missing-price-unit`,
 * `bad-price-unit`, `bad-price-amount`, `unknown-service`, `missing-seller`) are element-level — the
 * landed data-only engine reads tag presence and value domains, never a tag's elements — so they are a
 * **named gap**, not a silence: they live in `SHIPPING_OPTION_CONSTRAINTS`, a closed value a test reads.
 *
 * **ASSUMPTIONS** (as assumptions, with their falsifiers — `SHIPPING_READ_ASSUMPTIONS`, `shippingRead.ts`,
 * a value an app's on-screen assumption register can render): the `price` tag's third element IS the
 * unit; a ref is `30406:<seller pubkey>:<d>`; the service domain is the parser's closed five; the read
 * refuses on the parser's full required set; and only the `price` tag's unit is asserted so far.
 */
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'
import { SHIPPING_OPTION_KIND } from './shippingWorkflow'

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.shipping',
	kinds: [
		{
			kind: SHIPPING_OPTION_KIND,
			source: 'sdk/commerce/shipping/shippingWorkflow.ts',
			parser: 'src/lib/schemas/shippingOption.ts#ShippingOptionSchema',
			checks: [],
		},
	],
	contributions: [],
	accepts: [],
}
