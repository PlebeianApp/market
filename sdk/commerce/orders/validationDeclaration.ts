/**
 * orders/validationDeclaration.ts — this module's declaration (`design.md` §4.1).
 *
 * `orders` builds the order-message templates (`orderEvents.ts:4-5`) but **owns no kind**: the order
 * message's schema and meaning live in `messaging` (`messaging/orderSchema.ts`), the module that owns the
 * kind's spec. So its demand is routed, by name, as a **contribution** — and `messaging` admits it in its
 * own declaration's `accepts`. Both halves exist, so the composition merges this module's checks into the
 * owner's declaration; the merged declaration stays **the owner's** (`design.md` §4.5).
 */
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'
import { ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND } from './orderEvents'

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.orders',
	kinds: [],
	contributions: [
		{ kind: ORDER_PROCESS_KIND, via: 'commerce.messaging', source: 'sdk/commerce/orders/orderEvents.ts', checks: [] },
		{ kind: PAYMENT_RECEIPT_KIND, via: 'commerce.messaging', source: 'sdk/commerce/orders/orderEvents.ts', checks: [] },
	],
	accepts: [],
}
