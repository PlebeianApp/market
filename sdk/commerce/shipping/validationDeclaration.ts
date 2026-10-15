/**
 * shipping/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `shipping` owns kind 30406 (`shippingWorkflow.ts:1`), cited to the repository's own shipping-option
 * parser. `checks: []` is a declared "demands nothing yet".
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
